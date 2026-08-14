//! 把 `alert()` / `confirm()` / `prompt()` 補回 WKWebView。
//!
//! ## 為什麼需要這個檔
//!
//! wry（0.55）的 WKWebView UI delegate 只實作了檔案選擇面板 ——
//! `runJavaScriptAlertPanel…`、`ConfirmPanel…`、`TextInputPanel…` 三個
//! delegate 方法都沒實作。WebKit 的行為是：沒實作就**當作使用者立刻取消**。
//! 所以正式版裡 `confirm()` 永遠回 false、`prompt()` 永遠回 null，
//! 而且沒有任何錯誤 —— 版本取號、放行、還原快照、覆寫確認全部無聲失敗
//! （Scott 2026-08-14 回報「點取一個新版號無效」，就是這個）。
//!
//! ## 修法
//!
//! 啟動時拿到 wry 掛在 WKWebView 上的 delegate 實例，用 ObjC runtime 的
//! `class_addMethod` 把缺的三個方法**加**上去（不是換掉 delegate ——
//! 換掉會弄丟它已有的檔案面板實作）。實作用 NSAlert 跑 modal：
//! WebKit 會停住 JS 直到 completionHandler 被呼叫，這正是這三個 API
//! 同步語意的正規實作方式（Safari 也是這樣做的）。
//!
//! 前端的 40+ 個呼叫點一行都不用改。
#![cfg(target_os = "macos")]

use std::ffi::CStr;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::atomic::{AtomicBool, Ordering};

use block2::Block;
use objc2::ffi::{class_addMethod, object_getClass};
use objc2::runtime::{AnyClass, AnyObject, Bool, Imp, Sel};
use objc2::{msg_send, sel, MainThreadMarker};
use objc2_app_kit::{NSAlert, NSAlertFirstButtonReturn, NSTextField, NSView};
use objc2_foundation::{NSPoint, NSRect, NSSize, NSString};

/// install() 的自檢結果。ping 的 capabilities 讀它——wry 升版改 delegate
/// 結構讓補丁失效時，前端能偵測降級（改走頁內確認），而不是又一輪
/// 「按了沒反應」的無聲失敗。
pub static READY: AtomicBool = AtomicBool::new(false);

pub fn ready() -> bool {
    READY.load(Ordering::Relaxed)
}

/// modal 只能在主執行緒跑；delegate callback 本來就到主執行緒。
/// 這裡回 None 而不是 panic：呼叫端在 completionHandler 契約下，
/// 任何 panic 都必須先收斂成「取消」語意，不能讓例外穿出 delegate。
fn mtm() -> Option<MainThreadMarker> {
    MainThreadMarker::new()
}

fn make_alert(message: Option<&NSString>, m: MainThreadMarker) -> objc2::rc::Retained<NSAlert> {
    let alert = NSAlert::new(m);
    if let Some(msg) = message {
        alert.setMessageText(msg);
    }
    alert
}

/// alert()：一顆確定鈕，按完呼叫 handler。
unsafe extern "C-unwind" fn run_alert(
    _this: *mut AnyObject,
    _sel: Sel,
    _webview: *mut AnyObject,
    message: *mut NSString,
    _frame: *mut AnyObject,
    handler: *mut Block<dyn Fn()>,
) {
    eprintln!("[js-dialogs] alert() 被呼叫");
    // WKWebView 契約：completionHandler 沒被呼叫＝WebKit 丟 ObjC 例外直接
    // 終止 App。所以對話框邏輯整段包 catch_unwind，不管裡面發生什麼，
    // handler 一定在最後被呼叫恰好一次。
    let _ = catch_unwind(AssertUnwindSafe(|| {
        let Some(m) = mtm() else { return };
        let alert = make_alert(unsafe { message.as_ref() }, m);
        alert.addButtonWithTitle(&NSString::from_str("確定"));
        let _ = alert.runModal();
    }));
    if let Some(h) = unsafe { handler.as_ref() } {
        h.call(());
    }
}

/// confirm()：確定＝true、取消＝false。
unsafe extern "C-unwind" fn run_confirm(
    _this: *mut AnyObject,
    _sel: Sel,
    _webview: *mut AnyObject,
    message: *mut NSString,
    _frame: *mut AnyObject,
    handler: *mut Block<dyn Fn(Bool)>,
) {
    eprintln!("[js-dialogs] confirm() 被呼叫");
    // 同 alert：錯誤路徑一律收斂成「取消」（false），handler 必達。
    let ok = catch_unwind(AssertUnwindSafe(|| {
        let Some(m) = mtm() else { return false };
        let alert = make_alert(unsafe { message.as_ref() }, m);
        alert.addButtonWithTitle(&NSString::from_str("確定"));
        alert.addButtonWithTitle(&NSString::from_str("取消"));
        alert.runModal() == NSAlertFirstButtonReturn
    }))
    .unwrap_or(false);
    eprintln!("[js-dialogs] confirm() -> {ok}");
    if let Some(h) = unsafe { handler.as_ref() } {
        h.call((Bool::from(ok),));
    }
}

/// prompt()：NSAlert 掛一個 NSTextField 當輸入框。確定回輸入值、取消回 null。
unsafe extern "C-unwind" fn run_prompt(
    _this: *mut AnyObject,
    _sel: Sel,
    _webview: *mut AnyObject,
    message: *mut NSString,
    default_text: *mut NSString,
    _frame: *mut AnyObject,
    handler: *mut Block<dyn Fn(*mut NSString)>,
) {
    eprintln!("[js-dialogs] prompt() 被呼叫");
    // 同 alert：錯誤路徑一律收斂成「取消」（null），handler 必達。
    // Retained 值拿到 catch_unwind 外面再交給 handler——WebKit 會自己 copy。
    let value: Option<objc2::rc::Retained<NSString>> =
        catch_unwind(AssertUnwindSafe(|| {
            let m = mtm()?;
            let alert = make_alert(unsafe { message.as_ref() }, m);
            alert.addButtonWithTitle(&NSString::from_str("確定"));
            alert.addButtonWithTitle(&NSString::from_str("取消"));

            let field = {
                let frame = NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(260.0, 24.0));
                let field = NSTextField::initWithFrame(m.alloc::<NSTextField>(), frame);
                if let Some(d) = unsafe { default_text.as_ref() } {
                    field.setStringValue(d);
                }
                field
            };
            alert.setAccessoryView(Some(&field as &NSView));
            // 打開就能直接打字，不用先點輸入框
            alert.window().setInitialFirstResponder(Some(&field));

            if alert.runModal() == NSAlertFirstButtonReturn {
                Some(field.stringValue())
            } else {
                None
            }
        }))
        .unwrap_or(None);
    if let Some(h) = unsafe { handler.as_ref() } {
        match &value {
            Some(v) => h.call((objc2::rc::Retained::as_ptr(v) as *mut NSString,)),
            None => h.call((std::ptr::null_mut(),)),
        }
    }
}

/// 把三個方法加到 wry 的 UI delegate class 上。回傳加了幾個（重複呼叫是安全的
/// —— 已存在的方法 `class_addMethod` 會拒絕，不會蓋掉）。
///
/// # Safety
/// `webview` 必須是活著的 WKWebView 指標（來自 tauri 的 `with_webview`）。
pub unsafe fn install(webview: *mut AnyObject) -> usize {
    if webview.is_null() {
        return 0;
    }
    let delegate: *mut AnyObject = unsafe { msg_send![&*webview, UIDelegate] };
    if delegate.is_null() {
        eprintln!("[js-dialogs] WKWebView 沒有 UIDelegate，無法補 JS 對話框");
        return 0;
    }
    let cls = unsafe { object_getClass(delegate) } as *mut AnyClass;

    // type encoding：v=void 回傳、@=物件、:=selector、@?=block
    let enc3 = CStr::from_bytes_with_nul(b"v@:@@@@?\0").unwrap();
    let enc4 = CStr::from_bytes_with_nul(b"v@:@@@@@?\0").unwrap();

    let mut added = 0usize;
    unsafe {
        if class_addMethod(
            cls,
            sel!(webView:runJavaScriptAlertPanelWithMessage:initiatedByFrame:completionHandler:),
            std::mem::transmute::<*const (), Imp>(run_alert as *const ()),
            enc3.as_ptr(),
        )
        .as_bool()
        {
            added += 1;
        }
        if class_addMethod(
            cls,
            sel!(webView:runJavaScriptConfirmPanelWithMessage:initiatedByFrame:completionHandler:),
            std::mem::transmute::<*const (), Imp>(run_confirm as *const ()),
            enc3.as_ptr(),
        )
        .as_bool()
        {
            added += 1;
        }
        if class_addMethod(
            cls,
            sel!(webView:runJavaScriptTextInputPanelWithPrompt:defaultText:initiatedByFrame:completionHandler:),
            std::mem::transmute::<*const (), Imp>(run_prompt as *const ()),
            enc4.as_ptr(),
        )
        .as_bool()
        {
            added += 1;
        }
    }
    // WKWebView 在 setUIDelegate: 當下就快取了 delegate 實作哪些方法 ——
    // 事後用 class_addMethod 加的它看不見。重新 set 一次讓它重掃。
    unsafe {
        let () = msg_send![&*webview, setUIDelegate: std::ptr::null_mut::<AnyObject>()];
        let () = msg_send![&*webview, setUIDelegate: delegate];
    }
    // 自檢：WebKit 只會呼叫 respondsToSelector 過得了的方法
    unsafe {
        let a: Bool = msg_send![&*delegate, respondsToSelector: sel!(webView:runJavaScriptAlertPanelWithMessage:initiatedByFrame:completionHandler:)];
        let c: Bool = msg_send![&*delegate, respondsToSelector: sel!(webView:runJavaScriptConfirmPanelWithMessage:initiatedByFrame:completionHandler:)];
        let p: Bool = msg_send![&*delegate, respondsToSelector: sel!(webView:runJavaScriptTextInputPanelWithPrompt:defaultText:initiatedByFrame:completionHandler:)];
        eprintln!(
            "[js-dialogs] 已補上 {added}/3（重掛完成）responds: alert={} confirm={} prompt={}",
            a.as_bool(), c.as_bool(), p.as_bool()
        );
        // 三個 selector 都掛上才算 ready——ping 的 capabilities 讀這個旗標，
        // 讓前端在 wry 升版弄壞補丁時偵測得到降級。
        READY.store(a.as_bool() && c.as_bool() && p.as_bool(), Ordering::Relaxed);
    }
    added
}
