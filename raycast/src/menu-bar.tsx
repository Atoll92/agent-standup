import { Icon, launchCommand, LaunchType, MenuBarExtra, openExtensionPreferences, Keyboard } from "@raycast/api";
import { useCachedPromise } from "@raycast/utils";
import { ago, openCall, ORDER, projectLabel, readStatus, Session, sessionName, STATES, why } from "./standup";

// ✋ 2 when two sessions need you, ⚙ 3 when three are working, ✓ when it is your turn, nothing when all is quiet
function title(needsYou: number, working: number, yourTurn: number): string | undefined {
  if (needsYou) return `✋ ${needsYou}`;
  if (working) return `⚙ ${working}`;
  if (yourTurn) return "✓";
  return undefined;
}

export default function Command() {
  const { data, isLoading, error, revalidate } = useCachedPromise(readStatus, [], { keepPreviousData: true });
  const live = (data?.sessions || []).filter((s) => s.state !== "idle");
  const item = (s: Session) => {
    const st = STATES[s.state],
      w = why(s);
    return (
      <MenuBarExtra.Item
        key={s.project + "/" + s.id}
        icon={{ source: st.icon, tintColor: st.color }}
        title={sessionName(s).slice(0, 60)}
        subtitle={[projectLabel(s) !== sessionName(s) ? projectLabel(s) : "", w || st.label, ago(s.ageMs)]
          .filter(Boolean)
          .join(" · ")}
        tooltip={w || st.label}
        onAction={() => openCall(s.project)}
      />
    );
  };
  return (
    <MenuBarExtra
      icon={Icon.TwoPeople}
      title={data ? title(data.needsYou, data.working, data.yourTurn) : undefined}
      tooltip="Agent Standup"
      isLoading={isLoading}
    >
      {error ? <MenuBarExtra.Item icon={Icon.Warning} title={error.message.slice(0, 80)} /> : null}
      {data && !live.length ? <MenuBarExtra.Item title="No session at work" /> : null}
      {ORDER.filter((k) => k !== "idle").map((k) => {
        const list = live.filter((s) => s.state === k);
        return list.length ? (
          <MenuBarExtra.Section key={k} title={STATES[k].label}>
            {list.map(item)}
          </MenuBarExtra.Section>
        ) : null;
      })}
      <MenuBarExtra.Section>
        <MenuBarExtra.Item
          icon={Icon.Video}
          title="Open the Standup"
          shortcut={Keyboard.Shortcut.Common.Open}
          onAction={() => openCall()}
        />
        <MenuBarExtra.Item
          icon={Icon.List}
          title="All Sessions"
          onAction={() => launchCommand({ name: "sessions", type: LaunchType.UserInitiated })}
        />
        <MenuBarExtra.Item
          icon={Icon.ArrowClockwise}
          title="Refresh"
          shortcut={Keyboard.Shortcut.Common.Refresh}
          onAction={revalidate}
        />
        <MenuBarExtra.Item icon={Icon.Gear} title="Preferences…" onAction={openExtensionPreferences} />
      </MenuBarExtra.Section>
    </MenuBarExtra>
  );
}
