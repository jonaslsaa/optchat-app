// From T3 Code (MIT, see THIRD_PARTY_NOTICES.md): the row and its details from apps/web/src/components/chat/WorkLog.tsx, without
// the grouping, button and panel variants this app does not use.
import { useLayoutEffect, useRef, type ComponentProps, type ReactNode } from "react";
import { cn } from "./ui.tsx";

type RowContent = {
  icon?: ReactNode;
  label: ReactNode;
  trailing?: ReactNode;
};

function WorkLogLine({ icon, label, trailing }: RowContent) {
  return (
    <div className="enter flex min-h-6 min-w-0 items-center gap-1.5 text-sm leading-relaxed select-none [&_*]:select-none">
      <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
        {icon ? (
          <span className="relative w-6 shrink-0 leading-0">
            <span className="inline-block size-6 overflow-hidden align-[calc(0.5cap_-_0.75rem)]">
              <span className="flex size-full items-center justify-center">{icon}</span>
            </span>
          </span>
        ) : null}
        {/* One line, cut short, until the row is opened: then it is there whole, as it was written, and can be selected. */}
        <div className="min-w-0 flex-1 truncate text-secondary-label group-aria-expanded/timeline-row:cursor-text group-aria-expanded/timeline-row:select-text group-aria-expanded/timeline-row:whitespace-pre-wrap group-aria-expanded/timeline-row:[overflow-wrap:anywhere] group-aria-expanded/timeline-row:[&_*]:select-text">{label}</div>
      </div>
      {trailing}
    </div>
  );
}

const interactionClassName =
  "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70";

/** Div disclosure permits selectable detail and nested actions. */
export function WorkLogRow({
  icon,
  label,
  trailing,
  children,
  ...rowProps
}: RowContent & Omit<ComponentProps<"div">, "className" | "style">) {
  return (
    <div
      {...rowProps}
      className={cn(
        "group/timeline-row relative w-full min-w-0 rounded-md px-0.5 py-0.5 text-left transition-colors",
        rowProps.onClick !== undefined && interactionClassName,
      )}
    >
      <WorkLogLine icon={icon} label={label} trailing={trailing} />
      {children}
    </div>
  );
}

const LIVE_EDGE_PX = 4;

export function WorkLogDetails({ children, followLive = false }: { children: ReactNode; followLive?: boolean }) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const atLiveEdgeRef = useRef(true);
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (followLive && atLiveEdgeRef.current && scroller) {
      scroller.scrollTop = scroller.scrollHeight;
    }
  });
  return (
    <div
      ref={scrollerRef}
      onScroll={(event) => {
        const { scrollHeight, scrollTop, clientHeight } = event.currentTarget;
        atLiveEdgeRef.current = scrollHeight - scrollTop - clientHeight <= LIVE_EDGE_PX;
      }}
      className="enter ms-7 flex max-h-96 cursor-auto flex-col gap-3 overflow-auto px-0.5 py-1 select-text"
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {children}
    </div>
  );
}
