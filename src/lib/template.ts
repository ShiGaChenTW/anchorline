/**
 * `{{變數}}` 模板替換 —— 純函式，給 prompt 模板用。
 *
 * 認不得的佔位符**保留原樣**而不是換成空字串：使用者自訂 prompt 打錯
 * 變數名時，錯字要出現在送給模型的文字裡才看得到，靜默消失就查不到了。
 */
export function fillTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{(\w+)\}\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? vars[name]! : whole,
  );
}
