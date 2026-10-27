import { useState } from "react";
import { Box, Text, useInput } from "ink";
import { TextField } from "./TextField";
import { Panel } from "./Panel";
import { PromptHints } from "./PromptHints";
import { COLOR, ICON } from "../theme";
import type { PromptSpec } from "../store";

// One prompt for every typed setting (folder, speed limits, schedule): a
// titled field, an optional subject line above it and a format hint below.
export function InputPrompt({
  width,
  spec,
  onClose,
}: {
  width: number;
  spec: PromptSpec;
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  useInput((_input, key) => {
    if (key.escape) onClose();
  });

  return (
    <Box flexDirection="column" width={width}>
      <Panel title={spec.title} width={width} focused height={spec.subject ? 3 : 2}>
        {spec.subject ? (
          <Box>
            <Text dimColor wrap="truncate-end">
              {spec.subject}
            </Text>
          </Box>
        ) : null}
        <Box>
          <Text color={COLOR.accent}>{`${ICON.pointer} `}</Text>
          <Box flexGrow={1} minWidth={0}>
            <TextField
              defaultValue={spec.value}
              placeholder={spec.placeholder ?? ""}
              width={Math.max(1, width - 6)}
              onChange={() => setError(null)}
              onSubmit={(v) => {
                const err = spec.onSubmit(v);
                if (err) setError(err);
                else onClose();
              }}
            />
          </Box>
        </Box>
      </Panel>
      {error ? (
        <Text color={COLOR.bad}>{`${ICON.error} ${error}`}</Text>
      ) : spec.hint ? (
        <Text dimColor>{spec.hint}</Text>
      ) : null}
      <Box marginTop={1}>
        <PromptHints submitLabel={spec.submitLabel ?? "save"} />
      </Box>
    </Box>
  );
}
