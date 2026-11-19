/** Every element nw_inc_nui.nss can make: drag one onto the canvas or the tree, or click to add it at the selection. */
import { ELEMENTS, type ElementSpec } from "../../core/edit/catalog.js";
import { PALETTE_MIME } from "./Canvas.js";
import { Icon, typeIcon } from "./icons.js";

const CATEGORIES: ElementSpec["category"][] = ["Layout", "Text", "Buttons", "Input", "Display", "Drawing"];

export function Palette({ onAdd }: { onAdd(type: string): void }) {
  return (
    <div className="palette" data-testid="palette">
      {CATEGORIES.map((c) => (
        <div key={c} className="palette-group">
          <div className="palette-head">{c}</div>
          <div className="palette-grid">
            {ELEMENTS.filter((e) => e.category === c).map((e) => (
              <button
                key={e.type}
                className="tile"
                draggable
                data-type={e.type}
                title={`${e.title} (${e.builder}): ${e.blurb}\nDrag onto the canvas or the tree, or click to add it at the selection.`}
                onDragStart={(ev) => {
                  ev.dataTransfer.setData(PALETTE_MIME + e.type, e.type);
                  ev.dataTransfer.setData("text/plain", e.builder);
                  ev.dataTransfer.effectAllowed = "copy";
                }}
                onClick={() => onAdd(e.type)}
              >
                <Icon name={typeIcon(e.type)} size={18} />
                <span>{e.title}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
