import { Box, Text, useInput } from "ink";
import { CATEGORIES } from "../../download/types";
import { matchesFilter, useQueueItems, useStore, type Filter } from "../store";
import { wrapStep } from "../move";
import { COLOR, GUTTER } from "../theme";

interface NavItem {
  key: Filter;
  label: string;
}

const GROUPS: NavItem[][] = [
  [
    { key: "all", label: "All" },
    { key: "active", label: "Unfinished" },
    { key: "finished", label: "Finished" },
  ],
  CATEGORIES.map((c) => ({ key: c, label: c })),
];

const NAV: NavItem[] = GROUPS.flat();

const BADGE_W = " (000)".length;

export const RAIL_WIDTH = GUTTER + Math.max(...NAV.map((n) => n.label.length)) + BADGE_W;

export function Sidebar() {
  const { filter, setFilter, region, setRegion, queue, overlayOpen } = useStore();
  const items = useQueueItems(queue);
  const focused = region === "sidebar";
  const idx = Math.max(0, NAV.findIndex((n) => n.key === filter));

  useInput(
    (input, key) => {
      if (key.upArrow || input === "k") setFilter(NAV[wrapStep(idx, -1, NAV.length)]!.key);
      else if (key.downArrow || input === "j") setFilter(NAV[wrapStep(idx, 1, NAV.length)]!.key);
      else if (key.return) setRegion("content");
    },
    { isActive: focused && !overlayOpen },
  );

  return (
    <Box flexDirection="column" width={RAIL_WIDTH} marginRight={1}>
      {GROUPS.map((group, gi) => (
        <Box key={gi} flexDirection="column" marginTop={gi > 0 ? 1 : 0}>
          {group.map((item) => {
            const selected = item.key === filter;
            const n = items.filter((it) => matchesFilter(it, item.key)).length;
            return (
              <Box key={item.key}>
                <Box width={GUTTER} flexShrink={0}>
                  {selected ? (
                    <Text color={focused ? COLOR.bright : COLOR.rule} bold={focused}>
                      ▌
                    </Text>
                  ) : null}
                </Box>
                <Text
                  color={selected ? (focused ? COLOR.accent : COLOR.alt) : undefined}
                  dimColor={!selected}
                  bold={selected && focused}
                >
                  {item.label}
                </Text>
                {n > 0 ? <Text dimColor>{` (${n})`}</Text> : null}
              </Box>
            );
          })}
        </Box>
      ))}
    </Box>
  );
}
