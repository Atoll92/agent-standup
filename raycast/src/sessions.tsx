import { Action, ActionPanel, Icon, List, Keyboard } from "@raycast/api";
import { useCachedPromise } from "@raycast/utils";
import { ago, NoNode, openCall, ORDER, projectLabel, readStatus, sessionName, STATES, why } from "./standup";

export default function Command() {
  const { data, isLoading, error, revalidate } = useCachedPromise(readStatus, [], { keepPreviousData: true });
  const sessions = data?.sessions || [];
  const actions = (project?: string, id?: string) => (
    <ActionPanel>
      <Action icon={Icon.Video} title="Open the Standup" onAction={() => openCall()} />
      {project && !project.startsWith("_") ? (
        <Action icon={Icon.Folder} title="Open This Project's Call" onAction={() => openCall(project)} />
      ) : null}
      {id ? <Action.CopyToClipboard title="Copy Session ID" content={id} /> : null}
      <Action
        icon={Icon.ArrowClockwise}
        title="Refresh"
        shortcut={Keyboard.Shortcut.Common.Refresh}
        onAction={revalidate}
      />
    </ActionPanel>
  );
  return (
    <List isLoading={isLoading} searchBarPlaceholder="Filter sessions by title or project">
      {error ? (
        <List.EmptyView
          icon={Icon.Warning}
          title={error instanceof NoNode ? "Node.js not found" : "Could not read the sessions"}
          description={error.message}
          actions={actions()}
        />
      ) : (
        <List.EmptyView
          icon={Icon.TwoPeople}
          title="No session lately"
          description="Sessions of Claude Code, Codex, Mistral Vibe and Cowork show here while they run."
          actions={actions()}
        />
      )}
      {ORDER.map((k) => {
        const list = sessions.filter((s) => s.state === k);
        return list.length ? (
          <List.Section key={k} title={STATES[k].label} subtitle={String(list.length)}>
            {list.map((s) => {
              const st = STATES[s.state],
                w = why(s),
                name = sessionName(s),
                proj = projectLabel(s);
              return (
                <List.Item
                  key={s.project + "/" + s.id}
                  icon={{ source: st.icon, tintColor: st.color }}
                  title={name}
                  subtitle={w || (proj !== name ? proj : "")}
                  keywords={[proj, s.id]}
                  accessories={[
                    ...(s.subAgents
                      ? [
                          {
                            icon: Icon.TwoPeople,
                            text: `${s.subAgentsActive || 0}/${s.subAgents}`,
                            tooltip: "Sub-agents at work / in all",
                          },
                        ]
                      : []),
                    ...(proj !== name && w ? [{ tag: proj }] : []),
                    { text: ago(s.ageMs), tooltip: st.label },
                  ]}
                  actions={actions(s.project, s.id)}
                />
              );
            })}
          </List.Section>
        ) : null;
      })}
    </List>
  );
}
