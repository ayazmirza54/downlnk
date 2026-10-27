import { Box, Text } from "ink";
import { LOGO_LINES, SPROUT_CELLS } from "../logo";
import { COLOR, lerpHex } from "../theme";

// Read the palette per call so a theme switch recolors the logo.
function getSheen(t: number): string {
  if (t < 0.15) return lerpHex(COLOR.highlight, COLOR.bright, t / 0.15);
  if (t < 0.4) return lerpHex(COLOR.bright, COLOR.accent, (t - 0.15) / 0.25);
  if (t < 0.7) return lerpHex(COLOR.accent, COLOR.deep, (t - 0.4) / 0.3);
  return lerpHex(COLOR.deep, COLOR.shade, (t - 0.7) / 0.3);
}

export function Logo() {
  const rows = LOGO_LINES.length;

  return (
    <Box flexDirection="column">
      {LOGO_LINES.map((line, row) => {
        const textRow = Math.max(0, row - 1);
        const textRows = Math.max(1, rows - 1);
        const tY = textRow / (textRows - 1 || 1);
        const chars = [...line];
        const last = Math.max(1, chars.length - 1);

        return (
          <Box key={row}>
            {chars.map((ch, i) => {
              if (ch === " ") return <Text key={i}> </Text>;

              if (SPROUT_CELLS.has(`${row},${i}`)) {
                return (
                  <Text key={i} bold color={COLOR.sprout}>
                    {ch}
                  </Text>
                );
              }

              const tX = i / last;
              const factor = (tX + tY) / 2;

              return (
                <Text key={i} bold color={getSheen(factor)}>
                  {ch}
                </Text>
              );
            })}
          </Box>
        );
      })}
    </Box>
  );
}
