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

use block2::Block;
use objc2::ffi::{class_addMethod, object_getClass};
use objc2::runtime::{AnyClass, AnyObject, Bool, Imp, Sel};
use objc2::{msg_send, sel, MainThreadMarker};
use objc2_app_kit::{NSAlert, NSAlertFirstButtonReturn, NSTextField, NSView};
use objc2_foundation::{NSPoint, NSRect, NSSize, NSString};

/// modal 只能在主執行緒跑；delegate callback 本來就到主執行緒，
/// 這裡的 unwrap 掛掉代表 WebKit 的執行緒模型變了，值得直接炸出來。
fn mtm() -> MainThreadMarker {
    MainThreadMarker::new().expect("WKUIDelegate callback 不在主執行緒")
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
    let m = mtm();
    let alert = make_alert(unsafe { message.as_ref() }, m);
    alert.addButtonWithTitle(&NSString::from_str("確定"));
    let _ = alert.runModal();
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
    let m = mtm();
    let alert = make_alert(unsafe { message.as_ref() }, m);
    alert.addButtonWithTitle(&NSString::from_str("確定"));
    alert.addButtonWithTitle(&NSString::from_str("取消"));
    let ok = alert.runModal() == NSAlertFirstButtonReturn;
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
    let m = mtm();
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

    let ok = alert.runModal() == NSAlertFirstButtonReturn;
    if let Some(h) = unsafe { handler.as_ref() } {
        if ok {
            let value = field.stringValue();
            // Retained 在 call 期間都活著；WebKit 會自己 copy 這個字串
            h.call((objc2::rc::Retained::as_ptr(&value) as *mut NSString,));
        } else {
            h.call((std::ptr::null_mut(),));
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
    }
    added
}
