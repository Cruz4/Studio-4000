// Fallback editor for plug-ins without a dedicated one: parameters grouped into panels of knobs and switches.
import { useMemo, useState } from "react";
import type { Param } from "../../types";
import { BAND_COLORS, Knob, Pick, Section, Seg, Toggle } from "./core";
import type { Fx } from "./core";

/** "Osc 2 Tune" → "Osc 2"; "Filter Cutoff" → "Filter"; parameters left alone go to "Main". */
function groupOf(name: string) {
  const numbered = name.match(/^([A-Za-z][A-Za-z ]*?\s?\d+)\s+\S/);
  if (numbered) return numbered[1].trim();
  const first = name.match(/^([A-Za-z]+)[\s:_-]+\S/);
  return first ? first[1] : "Main";
}

export function GenericEditor({ fx }: { fx: Fx }) {
  const [query, setQuery] = useState("");
  const groups = useMemo(() => {
    const visible = fx.params.filter((p) => p && typeof p.name === "string" && (!query || p.name.toLowerCase().includes(query.toLowerCase())));
    const map = new Map<string, Param[]>();
    for (const p of visible) {
      const g = groupOf(p.name);
      map.set(g, [...(map.get(g) ?? []), p]);
    }
    const main: Param[] = [];
    const out: [string, Param[]][] = [];
    for (const [g, ps] of map) (ps.length < 2 ? main.push(...ps) : out.push([g, ps]));
    return main.length ? [["Main", main] as [string, Param[]], ...out] : out;
  }, [fx.params, query]);

  const short = (group: string, name: string) => (group !== "Main" && name.startsWith(group) ? name.slice(group.length).trim() || name : name);

  return (
    <div className="fx-layout">
      {fx.params.length > 12 && (
        <input className="input sm" placeholder={`Filter ${fx.params.length} parameters`} value={query} onChange={(e) => setQuery(e.target.value)} />
      )}
      <div className="fx-generic">
        {groups.map(([g, ps], gi) => (
          <Section key={g} title={g}>
            <div className="fx-row knobs wrap">
              {ps.map((p) =>
                p.options?.length === 2 ? <Toggle key={p.id} fx={fx} pid={p.id} label={short(g, p.name)} />
                  : p.options && p.options.length <= 5 ? <Seg key={p.id} fx={fx} pid={p.id} label={short(g, p.name)} small />
                    : p.options?.length ? <Pick key={p.id} fx={fx} pid={p.id} label={short(g, p.name)} />
                      : <Knob key={p.id} fx={fx} pid={p.id} label={short(g, p.name)} color={BAND_COLORS[(gi + 3) % BAND_COLORS.length]} size={44} />,
              )}
            </div>
          </Section>
        ))}
        {!groups.length && <span className="small faint">{fx.ready ? "This plug-in exposes no parameters." : "Loading…"}</span>}
      </div>
    </div>
  );
}
