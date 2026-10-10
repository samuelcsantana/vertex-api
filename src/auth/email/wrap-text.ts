export function wrapText(paragraph: string, width: number): readonly string[] {
  return paragraph.split(' ').reduce<readonly string[]>((lines, word) => {
    const last = lines.at(-1);
    if (last !== undefined && last.length + 1 + word.length <= width) {
      return [...lines.slice(0, -1), `${last} ${word}`];
    }
    return [...lines, word];
  }, []);
}
