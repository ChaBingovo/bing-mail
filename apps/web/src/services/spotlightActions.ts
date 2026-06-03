import type { AppContextValue } from "../context/AppContext";
import type { MessageMeta } from "../types";
import type { SpotlightAction } from "../components/Spotlight";

export function createSpotlightActionBuilder(params: {
  app: AppContextValue;
  mailbox: () => string;
  aliases: () => string[];
  displayAddress: () => string;
  setDisplayAddress: (v: string) => void;
  messages: () => MessageMeta[];
}) {
  return (q: string): SpotlightAction[] => {
    const query = (q || "").trim().toLowerCase();
    const actions: SpotlightAction[] = [];

    actions.push({
      key: "nav-inbox",
      title: "收件箱",
      subtitle: "跳转到收件箱",
      right: "↩",
      onPick: () => params.app.setPage("inbox"),
    });
    actions.push({
      key: "nav-settings",
      title: "账户设置",
      subtitle: "跳转到账户设置",
      onPick: () => params.app.setPage("settings"),
    });
    if (params.app.currentUser()?.isAdmin) {
      actions.push({
        key: "nav-admin",
        title: "管理员设置",
        subtitle: "跳转到管理员设置",
        onPick: () => params.app.setPage("admin"),
      });
    }

    const addrItems = [params.mailbox(), ...params.aliases()].filter(Boolean);
    addrItems.forEach((a) => {
      actions.push({
        key: `addr-${a}`,
        title: a,
        subtitle: "切换显示邮箱地址",
        right: a === params.displayAddress() ? "当前" : "",
        onPick: () => params.setDisplayAddress(a),
      });
    });

    const list = params.messages() || [];
    const filtered =
      query.length === 0
        ? []
        : list
            .filter((m) => {
              const s = `${m.subject || ""} ${m.fromName || ""} ${m.fromAddress || ""} ${m.snippet || ""} ${
                m.aiCode || ""
              } ${m.aiService || ""}`.toLowerCase();
              return s.includes(query);
            })
            .slice(0, 10);
    filtered.forEach((m) => {
      actions.push({
        key: `msg-${m.id}`,
        title: m.subject || "(无主题)",
        subtitle: m.fromName || m.fromAddress || "",
        right: "打开",
        onPick: () => {
          params.app.setPage("inbox");
          params.app.setSelectedId(m.id);
        },
      });
    });

    if (!query) return actions;
    return actions.filter((a) => `${a.title} ${a.subtitle || ""}`.toLowerCase().includes(query));
  };
}

