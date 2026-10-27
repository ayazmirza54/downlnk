import { Box, Text, useInput, useStdin } from "ink";
import { Logo } from "../components/Logo";
import { UrlBar } from "../components/UrlBar";
import { LOGO_WIDTH } from "../logo";
import { COLOR, ICON } from "../theme";

const SITES = ["youtube", "instagram", "facebook", "reddit", "x", "tiktok", "any file"].join(`  ${ICON.dot}  `);

export function Splash({
  cols,
  rows,
  waiting,
  onSubmit,
  onBrowse,
  onQuit,
}: {
  cols: number;
  rows: number;
  waiting: number;
  onSubmit: (text: string) => void;
  onBrowse: () => void;
  onQuit: () => void;
}) {
  const { isRawModeSupported } = useStdin();
  useInput(
    (input, key) => {
      if (key.escape || (key.ctrl && input === "c")) onQuit();
    },
    { isActive: isRawModeSupported },
  );

  const showLogo = cols >= LOGO_WIDTH + 2;
  const barWidth = Math.max(24, Math.min(cols - 6, 68));

  return (
    <Box height={Math.max(1, rows - 1)} flexDirection="column" justifyContent="center" alignItems="center">
      {showLogo ? (
        <Logo />
      ) : (
        <Text bold color={COLOR.accent}>
          downlnk
        </Text>
      )}
      <Box marginTop={2}>
        <Text color={COLOR.text}>A download manager that lives in your terminal.</Text>
      </Box>
      <Box>
        <Text dimColor>{SITES}</Text>
      </Box>

      <Box marginTop={1} width={barWidth}>
        <UrlBar
          width={barWidth}
          editing
          placeholder="Paste a link, or several…"
          onSubmit={(v) => (v.trim() ? onSubmit(v) : onBrowse())}
          onExitDown={onBrowse}
        />
      </Box>
      <Box marginTop={1}>
        <Text>
          <Text color={COLOR.alt}>↵</Text>
          <Text dimColor> download</Text>
          <Text dimColor>{`  ${ICON.dot}  `}</Text>
          <Text color={COLOR.alt}>⇥</Text>
          <Text dimColor>{waiting ? ` downloads (${waiting} waiting)` : " downloads"}</Text>
          <Text dimColor>{`  ${ICON.dot}  `}</Text>
          <Text color={COLOR.alt}>^c</Text>
          <Text dimColor> quit</Text>
        </Text>
      </Box>
    </Box>
  );
}
