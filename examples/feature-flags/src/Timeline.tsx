export interface TimelineEntry {
  time: number;
  event: string;
  detail: string;
  type: string;
}

interface TimelineProps {
  entries: TimelineEntry[];
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function Timeline({ entries }: TimelineProps) {
  return (
    <>
      <div className="ff-timeline-header">Event Timeline</div>
      <div className="ff-timeline">
        {entries.length === 0 ? (
          <div className="ff-timeline-empty">Events appear after interactions</div>
        ) : (
          entries.map((entry, i) => (
            <div key={i} className={`ff-timeline-entry ${entry.type}`}>
              <span className="ff-timeline-time">{formatTime(entry.time)}</span>
              <span className="ff-timeline-event">{entry.event}</span>
              <span className="ff-timeline-detail">{entry.detail}</span>
            </div>
          ))
        )}
      </div>
    </>
  );
}
