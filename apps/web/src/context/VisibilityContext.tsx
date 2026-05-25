import { createContext, createSignal, onCleanup, onMount, useContext } from "solid-js";

export type VisibilityContextValue = {
  isVisible: () => boolean;
};

const Ctx = createContext<VisibilityContextValue>();

export function VisibilityProvider(props: { children: any }) {
  const [isVisible, setIsVisible] = createSignal(typeof document !== "undefined" ? !document.hidden : true);

  onMount(() => {
    const onVis = () => setIsVisible(!document.hidden);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    onCleanup(() => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
    });
  });

  return <Ctx.Provider value={{ isVisible }}>{props.children}</Ctx.Provider>;
}

export function useVisibility() {
  const v = useContext(Ctx);
  if (!v) throw new Error("VisibilityContextMissing");
  return v;
}

