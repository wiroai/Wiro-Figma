import { useEffect, useState } from 'preact/hooks';
import type { RecentImage } from '../shared/messages';
import { RecentStrip } from './action-view';
import { formatUsd, describeError } from './format';
import { placeResults } from './place';
import { imageOutputs, svgOutputs } from './results';
import { useApp } from './state';
import type { TaskListItem } from './wiro';

// Results from this computer (Recent) and the account's latest tasks from
// every app, with their images ready to place again.

export function HistoryView(props: { active: boolean }) {
  const app = useApp();
  const [tasks, setTasks] = useState<TaskListItem[] | null>(null);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);

  function load() {
    setLoading(true);
    setError(undefined);
    app.services.api
      .listTasks(40)
      .then(setTasks)
      .catch((caught: unknown) => setError(describeError(caught).message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (props.active) load();
  }, [props.active]);

  async function place(image: RecentImage) {
    try {
      const targetIds = app.selection.targets.map((target) => target.id);
      await placeResults(
        app,
        [image],
        image.kind === 'svg' ? { mode: 'beside', targetIds: [], anchorId: targetIds[0] } : { mode: 'fill', targetIds },
        { name: image.prompt, model: image.model, taskId: image.taskId },
      );
    } catch (caught) {
      app.notify(caught instanceof Error ? caught.message : String(caught), true);
    }
  }

  // Only tasks with something to place: pictures or vectors.
  const rows = (tasks ?? []).filter(
    (item) =>
      item.state === 'completed' && (imageOutputs({ ...item }).length > 0 || svgOutputs({ ...item }).length > 0),
  );

  return (
    <div class="tab-body">
      <div class="scroll">
        {app.recent.length > 0 ? (
          <RecentStrip />
        ) : (
          <p class="hint">Images you make in this plugin show up here, ready to place again.</p>
        )}
        <section class="history">
          <div class="section-head">
            <span class="section-label">Your Wiro AI tasks</span>
            <button type="button" class="link small" onClick={load} disabled={loading}>
              {loading ? 'Loading…' : 'Refresh'}
            </button>
          </div>
          <p class="fine">
            Images and vectors from this project&apos;s latest tasks, made in any app. Click one to place it.
          </p>
          {error && <div class="notice error">{error}</div>}
          {tasks !== null && rows.length === 0 && !error && <p class="muted">No images among the latest tasks yet.</p>}
          {rows.map((item) => {
            const pictures = imageOutputs({ ...item, state: item.state });
            const vectors = svgOutputs({ ...item, state: item.state });
            const cost = item.task.chargedUsd ?? item.task.costUsd;
            const model = item.task.model ?? 'model';
            return (
              <div class="task-row" key={item.task.id ?? item.task.token}>
                <div class="task-meta">
                  <span class="slug">{model}</span>
                  <span class="title">
                    {[item.task.id ? `Task ${item.task.id}` : '', typeof cost === 'number' ? formatUsd(cost) : '']
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </div>
                {
                  <div class="task-thumbs">
                    {[
                      ...pictures.map((output) => ({ output, kind: undefined })),
                      ...vectors.map((output) => ({ output, kind: 'svg' as const })),
                    ]
                      .slice(0, 4)
                      .map(({ output, kind }) => (
                        <button
                          type="button"
                          class={kind === 'svg' ? 'thumb small vector' : 'thumb small'}
                          key={output.url}
                          title="Place this"
                          onClick={() =>
                            void place({
                              url: output.url!,
                              kind,
                              model,
                              prompt: model,
                              taskId: item.task.id,
                              createdAt: Date.now(),
                            })
                          }
                        >
                          <img src={output.url} alt="" loading="lazy" />
                        </button>
                      ))}
                  </div>
                }
              </div>
            );
          })}
        </section>
      </div>
    </div>
  );
}
