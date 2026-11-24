export function shouldUseOneShotEdit(opts: {
  quickPatch: boolean;
  fullRewrite: boolean;
  hasSelectedTarget: boolean;
  hasSeededSnippet: boolean;
  prompt: string;
}): boolean {
  if (!opts.quickPatch || opts.fullRewrite || !opts.hasSelectedTarget || !opts.hasSeededSnippet) return false;
  const instruction = String(opts.prompt || "")
    .replace(/\[Выбранный элемент:[\s\S]*?\]\s*/i, "")
    .trim();
  if (!instruction || instruction.length > 240) return false;
  return !/(полностью|с\s+нуля|переработ|нов(?:ый|ую|ое)\s+(?:блок|секци|страниц)|анимац|three\s*\.\s*js|\b3d\b|несколько)/i.test(instruction);
}
