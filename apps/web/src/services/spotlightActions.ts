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
  canSend?: () => boolean;
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
    if (!params.canSend || params.canSend()) {
      actions.push({
        key: "nav-compose",
        title: "写邮件",
        subtitle: "撰写并发送新邮件",
        right: "↩",
        onPick: () => params.app.setPage("compose"),
      });
    }
    actions.push({
      key: "nav-sent",
      title: "已发邮件",
      subtitle: "查看已发送邮件记录",
      right: "↩",
      onPick: () => params.app.setPage("sent"),
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

    actions.push({
      key: "addr-all",
      title: "全部收件箱",
      subtitle: "显示主邮箱与全部别名收件",
      right: params.displayAddress() === "" ? "当前" : "",
      onPick: () => {
        params.setDisplayAddress("");
        params.app.setPage("inbox");
      },
    });
    const addrItems = [params.mailbox(), ...params.aliases()].filter(Boolean);
    addrItems.forEach((a) => {
      actions.push({
        key: `addr-${a}`,
        title: a,
        subtitle: "筛选该邮箱收件",
        right: a === params.displayAddress() ? "当前" : "",
        onPick: () => {
          params.setDisplayAddress(a);
          params.app.setPage("inbox");
        },
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

