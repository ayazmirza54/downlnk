import { Box, Text } from "ink";
import { TextField } from "./TextField";
import { Panel } from "./Panel";
import { COLOR, ICON } from "../theme";

interface UrlBarProps {
  width: number;
  editing: boolean;
  placeholder?: string;
  onSubmit: (value: string) => void;
  onExitDown?: () => void;
}

export function UrlBar({
  width,
  editing,
  placeholder = "Paste a link: YouTube, Instagram, Reddit, any file…",
  onSubmit,
  onExitDown,
}: UrlBarProps) {
  return (
    <Panel title="add" width={width} focused={editing} height={2}>
      <Box>
        <Text color={COLOR.accent}>{`${ICON.pointer} `}</Text>
        <Box flexGrow={1} minWidth={0}>
          {editing ? (
            <TextField
              placeholder={placeholder}
              width={Math.max(1, width - 6)}
              onSubmit={onSubmit}
              onExitDown={onExitDown}
            />
          ) : (
            <Text dimColor wrap="truncate-end">
              {`${placeholder}   (a or / to type, v to paste)`}
            </Text>
          )}
        </Box>
      </Box>
    </Panel>
  );
}
