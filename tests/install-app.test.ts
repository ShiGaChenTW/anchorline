import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "bun:test";
import {
  backupPathFor,
  buildManifest,
  collectEntries,
  digestOfManifest,
  formatDuration,
  formatFingerprint,
  formatLocalMinute,
  hashBundle,
  installBundle,
  isStaleBuild,
  parseFlags,
  resolveBundlePath,
  toPgrepPattern,
  variantFor,
  verifyDigests,
  type BundleEntry,
} from "../scripts/install-app";

// 這份測試釘住純函式，外加「真的建一個小 .app、真的跑 ditto、真的走一次回滾」。
// 不 mock 檔案系統、不跑 tauri build——把 rename/ditto/雜湊/回滾整條 mock 掉的話，
// 釘住的只會是 mock 自己的行為。

const sandboxes: string[] = [];

function sandbox(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  sandboxes.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of sandboxes) rmSync(dir, { recursive: true, force: true });
});

/** 建一個內容固定的小 bundle 骨架；marker 用來區分「舊版」與「新版」。 */
function makeBundle(root: string, marker = "v1"): string {
  mkdirSync(join(root, "Contents", "MacOS"), { recursive: true });
  mkdirSync(join(root, "Contents", "Resources"), { recursive: true });
  writeFileSync(join(root, "Contents", "Info.plist"), `<plist>${marker}</plist>\n`);
  writeFileSync(join(root, "Contents", "MacOS", "anchorline"), `BINARY ${marker}\n`);
  chmodSync(join(root, "Contents", "MacOS", "anchorline"), 0o755);
  writeFileSync(join(root, "Contents", "Resources", "icon.icns"), "ICON\n");
  return root;
}

describe("parseFlags", () => {
  test("無參數時走正式版、兩個旗標都是關的", () => {
    expect(parseFlags([])).toEqual({ skipBuild: false, noOpen: false, variant: "release" });
  });

  test("--skip-build 與 --no-open 各自生效", () => {
    expect(parseFlags(["--skip-build"]).skipBuild).toBe(true);
    expect(parseFlags(["--no-open"]).noOpen).toBe(true);
  });

  test("--test 切到測試變體", () => {
    expect(parseFlags(["--test"]).variant).toBe("test");
    expect(parseFlags([]).variant).toBe("release");
  });

  test("多個旗標一起給，順序不影響結果", () => {
    const expected = { skipBuild: true, noOpen: true, variant: "test" as const };
    expect(parseFlags(["--skip-build", "--no-open", "--test"])).toEqual(expected);
    expect(parseFlags(["--test", "--no-open", "--skip-build"])).toEqual(expected);
  });

  test("重複給同一個旗標仍然合法", () => {
    expect(parseFlags(["--no-open", "--no-open"]).noOpen).toBe(true);
  });

  test("打錯字的旗標要丟錯而不是被忽略", () => {
    // 被忽略的話 --skipbuild 會靜默跑完整 build，正是這支腳本要避免的驚喜。
    expect(() => parseFlags(["--skipbuild"])).toThrow("--skipbuild");
    expect(() => parseFlags(["-s"])).toThrow("-s");
    expect(() => parseFlags(["--test", "extra"])).toThrow("extra");
  });
});

describe("variantFor / resolveBundlePath", () => {
  test("正式版路徑", () => {
    const v = variantFor("release");
    expect(v.productName).toBe("Anchorline");
    expect(v.identifier).toBe("dev.anchorline.app");
    expect(v.buildScript).toBe("app");
    expect(v.installPath).toBe("/Applications/Anchorline.app");
    expect(v.installedBinaryPath).toBe("/Applications/Anchorline.app/Contents/MacOS/anchorline");
    expect(resolveBundlePath("/repo", v)).toBe(
      "/repo/src-tauri/target/release/bundle/macos/Anchorline.app",
    );
  });

  test("測試版路徑", () => {
    const v = variantFor("test");
    expect(v.productName).toBe("Anchorline Test");
    expect(v.identifier).toBe("dev.anchorline.app.test");
    expect(v.buildScript).toBe("app:test");
    expect(v.installPath).toBe("/Applications/Anchorline Test.app");
    expect(resolveBundlePath("/repo", v)).toBe(
      "/repo/src-tauri/target/release/bundle/macos/Anchorline Test.app",
    );
  });

  test("兩個變體的路徑不能有任何重疊——寫死路徑就是裝錯變體的來源", () => {
    const a = variantFor("release");
    const b = variantFor("test");
    expect(a.installPath).not.toBe(b.installPath);
    expect(a.bundleRelativePath).not.toBe(b.bundleRelativePath);
    expect(a.buildScript).not.toBe(b.buildScript);
    // 執行檔名兩邊相同，所以只能靠完整路徑分辨。
    expect(a.installedBinaryPath.endsWith("/anchorline")).toBe(true);
    expect(b.installedBinaryPath.endsWith("/anchorline")).toBe(true);
  });
});

describe("backupPathFor", () => {
  test("備份與安裝路徑同目錄——rename 必須同檔案系統才是原子操作", () => {
    expect(backupPathFor("/Applications/Anchorline.app")).toBe(
      "/Applications/.Anchorline-install-backup",
    );
    expect(backupPathFor("/Applications/Anchorline Test.app")).toBe(
      "/Applications/.Anchorline Test-install-backup",
    );
  });

  test("備份名稱不以 .app 結尾，也不是可見檔", () => {
    // 留在 /Applications 的暫存若仍叫 *.app，LaunchServices 會把它收成第二個 App。
    for (const id of ["release", "test"] as const) {
      const backup = backupPathFor(variantFor(id).installPath);
      expect(backup.endsWith(".app")).toBe(false);
      expect(backup.split("/").pop()!.startsWith(".")).toBe(true);
    }
  });
});

describe("toPgrepPattern", () => {
  test("跳脫 ERE 中有特殊意義的字元", () => {
    expect(toPgrepPattern("/Applications/Anchorline.app/Contents/MacOS/anchorline")).toBe(
      "/Applications/Anchorline\\.app/Contents/MacOS/anchorline",
    );
  });

  test("空白原樣保留（pgrep 收到的是單一 argv，不經 shell）", () => {
    expect(toPgrepPattern("/Applications/Anchorline Test.app/x")).toBe(
      "/Applications/Anchorline Test\\.app/x",
    );
  });

  test("跳脫後正式版樣式不會誤中測試版路徑", () => {
    const release = new RegExp(toPgrepPattern(variantFor("release").installedBinaryPath));
    expect(release.test(variantFor("test").installedBinaryPath)).toBe(false);
    expect(release.test(variantFor("release").installedBinaryPath)).toBe(true);
  });
});

describe("buildManifest", () => {
  const file = (path: string, digest: string, mode = 0o100644): BundleEntry => ({
    path,
    kind: "file",
    digest,
    mode,
  });

  test("空清單得到空字串", () => {
    expect(buildManifest([])).toBe("");
  });

  test("行格式是 kind mode digest path，mode 只取權限位", () => {
    expect(buildManifest([file("Contents/Info.plist", "aa", 0o100644)])).toBe(
      "file 0644 aa Contents/Info.plist\n",
    );
    expect(buildManifest([file("Contents/Info.plist", "aa", 0o644)])).toBe(
      "file 0644 aa Contents/Info.plist\n",
    );
  });

  test("輸入順序不影響輸出——可重現性的核心", () => {
    const entries = [file("b", "2"), file("a", "1"), file("c", "3")];
    const shuffled = [entries[2]!, entries[0]!, entries[1]!];
    expect(buildManifest(shuffled)).toBe(buildManifest(entries));
    expect(buildManifest(entries)).toBe("file 0644 1 a\nfile 0644 2 b\nfile 0644 3 c\n");
  });

  test("掉了執行位就是不同的清單", () => {
    expect(buildManifest([file("Contents/MacOS/anchorline", "aa", 0o100755)])).not.toBe(
      buildManifest([file("Contents/MacOS/anchorline", "aa", 0o100644)]),
    );
  });

  test("同樣的 digest 但 kind 不同要能區分", () => {
    const asFile = buildManifest([{ path: "x", kind: "file", digest: "aa", mode: 0o644 }]);
    const asLink = buildManifest([{ path: "x", kind: "symlink", digest: "aa", mode: 0o644 }]);
    const asDir = buildManifest([{ path: "x", kind: "dir", digest: "aa", mode: 0o644 }]);
    expect(new Set([asFile, asLink, asDir]).size).toBe(3);
  });
});

describe("digestOfManifest", () => {
  test("對得上已知的 sha256 值", () => {
    expect(digestOfManifest("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(digestOfManifest("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  test("輸出永遠是 64 位小寫 hex", () => {
    expect(digestOfManifest("file 0644 aa a\n")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("verifyDigests", () => {
  const A = "a".repeat(64);
  const B = "b".repeat(64);

  test("兩邊相同且格式合法才算通過", () => {
    expect(verifyDigests(A, A)).toEqual({ ok: true, reason: null });
  });

  test("不符時回報兩邊的值", () => {
    const result = verifyDigests(A, B);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain(A);
    expect(result.reason).toContain(B);
  });

  test("空字串不算通過——雜湊算失敗時最容易誤判成一致", () => {
    expect(verifyDigests("", "").ok).toBe(false);
    expect(verifyDigests(A, "").ok).toBe(false);
    expect(verifyDigests("", A).ok).toBe(false);
  });

  test("格式不合法的雜湊一律擋掉", () => {
    expect(verifyDigests("A".repeat(64), "A".repeat(64)).ok).toBe(false); // 大寫
    expect(verifyDigests("abc", "abc").ok).toBe(false); // 太短
    expect(verifyDigests("z".repeat(64), "z".repeat(64)).ok).toBe(false); // 非 hex
  });
});

describe("formatDuration / formatLocalMinute / formatFingerprint", () => {
  test("一分鐘以內用秒，以上補零到兩位秒", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(1_500)).toBe("2s");
    expect(formatDuration(59_000)).toBe("59s");
    expect(formatDuration(60_000)).toBe("1m00s");
    expect(formatDuration(125_000)).toBe("2m05s");
  });

  test("時間戳走本地時區、分鐘精度", () => {
    expect(formatLocalMinute(new Date(2026, 7, 15, 8, 5))).toBe("2026-08-15 08:05");
  });

  test("指紋含 sha256 前 12 碼、commit、build 時間", () => {
    const line = formatFingerprint({
      digest: "61aecbb3095163e461e8752cb6104993c1eef4c7372a0689da372868e6470c76",
      head: "53596f9",
      bundleMtimeMs: new Date(2026, 7, 15, 8, 50).getTime(),
    });
    expect(line).toBe("sha256 61aecbb30951 · commit 53596f9 · build 2026-08-15 08:50");
  });

  test("拿不到 commit 時標成不明，而不是印空白", () => {
    expect(formatFingerprint({ digest: "a".repeat(64), head: null, bundleMtimeMs: 0 })).toContain(
      "commit (不明)",
    );
  });
});

describe("isStaleBuild", () => {
  test("產物比最後一次 commit 舊 → 警告", () => {
    expect(isStaleBuild(1_000, 2_000)).toBe(true);
  });

  test("產物比 commit 新或同時 → 不警告", () => {
    expect(isStaleBuild(2_000, 1_000)).toBe(false);
    expect(isStaleBuild(1_000, 1_000)).toBe(false);
  });

  test("拿不到 commit 時間就不猜", () => {
    expect(isStaleBuild(1_000, null)).toBe(false);
  });
});

describe("hashBundle（真的建一個目錄來雜湊，不 mock）", () => {
  test("兩份內容相同的 bundle 得到相同雜湊", () => {
    const a = makeBundle(sandbox("install-app-a-"));
    const b = makeBundle(sandbox("install-app-b-"));
    expect(hashBundle(a).digest).toBe(hashBundle(b).digest);
    expect(hashBundle(a).entryCount).toBe(6); // Contents + MacOS + Resources + 3 檔
  });

  test("同一份 bundle 連續雜湊兩次結果一致", () => {
    const dir = makeBundle(sandbox("install-app-stable-"));
    expect(hashBundle(dir).digest).toBe(hashBundle(dir).digest);
  });

  test("改一個位元組雜湊就變", () => {
    const a = makeBundle(sandbox("install-app-c-"));
    const b = makeBundle(sandbox("install-app-d-"));
    writeFileSync(join(b, "Contents", "MacOS", "anchorline"), "BINARZ v1\n");
    expect(hashBundle(a).digest).not.toBe(hashBundle(b).digest);
  });

  test("掉了執行位雜湊就變——內容雜湊看不出這件事", () => {
    const a = makeBundle(sandbox("install-app-e-"));
    const b = makeBundle(sandbox("install-app-f-"));
    chmodSync(join(b, "Contents", "MacOS", "anchorline"), 0o644);
    expect(hashBundle(a).digest).not.toBe(hashBundle(b).digest);
  });

  test("少一個空目錄雜湊就變", () => {
    const a = makeBundle(sandbox("install-app-g-"));
    const b = makeBundle(sandbox("install-app-h-"));
    mkdirSync(join(b, "Contents", "Frameworks"));
    expect(hashBundle(a).digest).not.toBe(hashBundle(b).digest);
  });

  test("symlink 記成 symlink 且不跟隨；斷鏈也不會炸", () => {
    const dir = makeBundle(sandbox("install-app-link-"));
    symlinkSync("Versions/A/Anchorline", join(dir, "Contents", "Frameworks-link"));
    symlinkSync("./nowhere-at-all", join(dir, "Contents", "broken-link"));

    const links = collectEntries(dir)
      .filter((e) => e.kind === "symlink")
      .map((e) => e.path)
      .sort();
    expect(links).toEqual(["Contents/Frameworks-link", "Contents/broken-link"]);
    expect(() => hashBundle(dir)).not.toThrow();
  });

  test("symlink 指向不同目標就是不同雜湊", () => {
    const a = makeBundle(sandbox("install-app-i-"));
    const b = makeBundle(sandbox("install-app-j-"));
    symlinkSync("Versions/A", join(a, "Contents", "Current"));
    symlinkSync("Versions/B", join(b, "Contents", "Current"));
    expect(hashBundle(a).digest).not.toBe(hashBundle(b).digest);
  });
});

describe("installBundle（真的 rename、真的 ditto、真的回滾）", () => {
  /** 一組沙盒：oldApp（舊版來源）、newApp（新版來源）、install（目標）、backup。 */
  function scene(prefix: string) {
    const box = sandbox(prefix);
    const oldApp = makeBundle(join(box, "old.app"), "old");
    const newApp = makeBundle(join(box, "new.app"), "new");
    const install = join(box, "Anchorline.app");
    const backup = join(box, ".Anchorline-install-backup");
    return { box, oldApp, newApp, install, backup };
  }

  function installOldVersion(oldApp: string, install: string): void {
    execFileSync("ditto", [oldApp, install]);
  }

  test("一切正常時換上新版，備份留給呼叫端清", () => {
    const s = scene("install-tx-ok-");
    installOldVersion(s.oldApp, s.install);

    const outcome = installBundle({ source: s.newApp, install: s.install, backup: s.backup });

    expect(outcome.ok).toBe(true);
    expect(outcome.reason).toBeNull();
    expect(outcome.rolledBack).toBe(false);
    expect(outcome.backupKept).toBe(s.backup);
    expect(existsSync(s.backup)).toBe(true); // 刻意不刪：呼叫端等啟動驗證過了才清
    expect(hashBundle(s.install).digest).toBe(hashBundle(s.newApp).digest);
    expect(outcome.targetDigest).toBe(hashBundle(s.newApp).digest);
  });

  test("sha256 不符 → 回滾，目標內容回到舊版", () => {
    const s = scene("install-tx-rollback-");
    installOldVersion(s.oldApp, s.install);
    const oldDigest = hashBundle(s.install).digest;

    // 故障注入：複製完成後把目標的執行位弄掉，讓雙邊雜湊必然不符。
    const outcome = installBundle({
      source: s.newApp,
      install: s.install,
      backup: s.backup,
      onAfterCopy: () => chmodSync(join(s.install, "Contents", "MacOS", "anchorline"), 0o644),
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.rolledBack).toBe(true);
    expect(outcome.reason).toContain("雜湊不符");
    expect(outcome.backupKept).toBeNull();
    expect(existsSync(s.backup)).toBe(false); // 備份被 rename 回去了，不是留在原地
    expect(existsSync(s.install)).toBe(true);
    expect(hashBundle(s.install).digest).toBe(oldDigest); // 逐位元組回到換裝前
    expect(hashBundle(s.install).digest).not.toBe(hashBundle(s.newApp).digest);
  });

  test("ditto 失敗（來源不存在）→ 回滾，舊版原封不動", () => {
    const s = scene("install-tx-ditto-fail-");
    installOldVersion(s.oldApp, s.install);
    const oldDigest = hashBundle(s.install).digest;

    const outcome = installBundle({
      source: join(s.box, "does-not-exist.app"),
      install: s.install,
      backup: s.backup,
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.rolledBack).toBe(true);
    expect(hashBundle(s.install).digest).toBe(oldDigest);
  });

  test("原本沒有安裝版時失敗 → 清掉半成品，不會留下壞掉的 app", () => {
    const s = scene("install-tx-fresh-fail-");
    expect(existsSync(s.install)).toBe(false);

    const outcome = installBundle({
      source: s.newApp,
      install: s.install,
      backup: s.backup,
      onAfterCopy: () => chmodSync(join(s.install, "Contents", "MacOS", "anchorline"), 0o644),
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.rolledBack).toBe(true);
    expect(existsSync(s.install)).toBe(false);
    expect(existsSync(s.backup)).toBe(false);
  });

  test("原本沒有安裝版時成功 → 沒有備份要清", () => {
    const s = scene("install-tx-fresh-ok-");
    const outcome = installBundle({ source: s.newApp, install: s.install, backup: s.backup });
    expect(outcome.ok).toBe(true);
    expect(outcome.backupKept).toBeNull();
    expect(hashBundle(s.install).digest).toBe(hashBundle(s.newApp).digest);
  });

  test("前一輪死在交易中途留下的孤兒備份會被救回，不會被當殘骸刪掉", () => {
    const s = scene("install-tx-orphan-");
    // 模擬上一輪：install 已 rename 到 backup，然後行程被殺，install 不存在。
    installOldVersion(s.oldApp, s.backup);
    expect(existsSync(s.install)).toBe(false);
    const oldDigest = hashBundle(s.backup).digest;

    const outcome = installBundle({
      source: s.newApp,
      install: s.install,
      backup: s.backup,
      onAfterCopy: () => chmodSync(join(s.install, "Contents", "MacOS", "anchorline"), 0o644),
    });

    // 復原 → 備份 → 複製 → 雜湊不符 → 回滾，最後應該回到那份被救起來的舊版。
    expect(outcome.ok).toBe(false);
    expect(outcome.rolledBack).toBe(true);
    expect(hashBundle(s.install).digest).toBe(oldDigest);
  });

  test("上一輪成功後沒清掉的殘骸備份會被丟棄，不影響換裝", () => {
    const s = scene("install-tx-stale-backup-");
    installOldVersion(s.oldApp, s.install);
    installOldVersion(s.oldApp, s.backup); // 兩邊都在＝殘骸

    const outcome = installBundle({ source: s.newApp, install: s.install, backup: s.backup });

    expect(outcome.ok).toBe(true);
    expect(hashBundle(s.install).digest).toBe(hashBundle(s.newApp).digest);
    // 這一輪自己的備份應該是換裝前的舊版
    expect(hashBundle(s.backup).digest).toBe(hashBundle(s.oldApp).digest);
  });
});
