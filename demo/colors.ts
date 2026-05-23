import { each, ensure, main, until } from "effection";
import {
  close,
  createTerm,
  fixed,
  grow,
  type InputEvent,
  type Op,
  open,
  rgba,
  text,
} from "../mod.ts";
import {
  alternateBuffer,
  cursor,
  mouseTracking,
  settings,
} from "../settings.ts";
import { useInput } from "./use-input.ts";
import { useStdin } from "./use-stdin.ts";

let SWATCHES = [
  { name: "Rose", r: 255, g: 0, b: 127 },
  { name: "Crimson", r: 220, g: 20, b: 60 },
  { name: "Tomato", r: 255, g: 99, b: 71 },
  { name: "Coral", r: 255, g: 127, b: 80 },
  { name: "Salmon", r: 250, g: 128, b: 114 },
  { name: "Scarlet", r: 255, g: 36, b: 0 },
  { name: "Vermillion", r: 227, g: 66, b: 52 },
  { name: "Rust", r: 183, g: 65, b: 14 },
  { name: "Terracotta", r: 204, g: 78, b: 92 },
  { name: "Brick", r: 203, g: 65, b: 84 },
  { name: "Tangerine", r: 255, g: 159, b: 0 },
  { name: "Amber", r: 255, g: 191, b: 0 },
  { name: "Marigold", r: 234, g: 162, b: 33 },
  { name: "Gold", r: 255, g: 215, b: 0 },
  { name: "Honey", r: 235, g: 177, b: 52 },
  { name: "Saffron", r: 244, g: 196, b: 48 },
  { name: "Canary", r: 255, g: 239, b: 0 },
  { name: "Lemon", r: 255, g: 247, b: 0 },
  { name: "Butter", r: 255, g: 225, b: 128 },
  { name: "Cream", r: 255, g: 253, b: 208 },
  { name: "Lime", r: 0, g: 255, b: 0 },
  { name: "Chartreuse", r: 127, g: 255, b: 0 },
  { name: "Emerald", r: 80, g: 200, b: 120 },
  { name: "Jade", r: 0, g: 168, b: 107 },
  { name: "Mint", r: 152, g: 255, b: 152 },
  { name: "Sage", r: 188, g: 184, b: 138 },
  { name: "Forest", r: 34, g: 139, b: 34 },
  { name: "Pine", r: 1, g: 121, b: 111 },
  { name: "Olive", r: 128, g: 128, b: 0 },
  { name: "Fern", r: 79, g: 121, b: 66 },
  { name: "Teal", r: 0, g: 128, b: 128 },
  { name: "Cyan", r: 0, g: 255, b: 255 },
  { name: "Aqua", r: 0, g: 255, b: 255 },
  { name: "Turquoise", r: 64, g: 224, b: 208 },
  { name: "Seafoam", r: 159, g: 226, b: 191 },
  { name: "Cerulean", r: 0, g: 123, b: 167 },
  { name: "Azure", r: 0, g: 127, b: 255 },
  { name: "Sky", r: 135, g: 206, b: 235 },
  { name: "Cornflower", r: 100, g: 149, b: 237 },
  { name: "Periwinkle", r: 204, g: 204, b: 255 },
  { name: "Cobalt", r: 0, g: 71, b: 171 },
  { name: "Royal", r: 65, g: 105, b: 225 },
  { name: "Navy", r: 0, g: 0, b: 128 },
  { name: "Midnight", r: 25, g: 25, b: 112 },
  { name: "Sapphire", r: 15, g: 82, b: 186 },
  { name: "Indigo", r: 75, g: 0, b: 130 },
  { name: "Violet", r: 127, g: 0, b: 255 },
  { name: "Amethyst", r: 153, g: 102, b: 204 },
  { name: "Lavender", r: 230, g: 230, b: 250 },
  { name: "Lilac", r: 200, g: 162, b: 200 },
  { name: "Plum", r: 142, g: 69, b: 133 },
  { name: "Orchid", r: 218, g: 112, b: 214 },
  { name: "Magenta", r: 255, g: 0, b: 255 },
  { name: "Fuchsia", r: 255, g: 0, b: 128 },
  { name: "Mauve", r: 224, g: 176, b: 255 },
  { name: "Berry", r: 142, g: 0, b: 82 },
  { name: "Wine", r: 114, g: 47, b: 55 },
  { name: "Burgundy", r: 128, g: 0, b: 32 },
  { name: "Maroon", r: 128, g: 0, b: 0 },
  { name: "Mahogany", r: 192, g: 64, b: 0 },
  { name: "Sienna", r: 160, g: 82, b: 45 },
  { name: "Chocolate", r: 123, g: 63, b: 0 },
  { name: "Cinnamon", r: 210, g: 105, b: 30 },
  { name: "Caramel", r: 255, g: 213, b: 128 },
  { name: "Peach", r: 255, g: 218, b: 185 },
  { name: "Apricot", r: 251, g: 206, b: 177 },
  { name: "Sand", r: 194, g: 178, b: 128 },
  { name: "Tan", r: 210, g: 180, b: 140 },
  { name: "Khaki", r: 195, g: 176, b: 145 },
  { name: "Taupe", r: 72, g: 60, b: 50 },
  { name: "Ivory", r: 255, g: 255, b: 240 },
  { name: "Pearl", r: 234, g: 224, b: 200 },
  { name: "Linen", r: 250, g: 240, b: 230 },
  { name: "Bone", r: 227, g: 218, b: 201 },
  { name: "Ash", r: 178, g: 190, b: 181 },
  { name: "Silver", r: 192, g: 192, b: 192 },
  { name: "Pewter", r: 150, g: 150, b: 150 },
  { name: "Slate", r: 112, g: 128, b: 144 },
  { name: "Charcoal", r: 54, g: 69, b: 79 },
  { name: "Graphite", r: 56, g: 56, b: 56 },
  { name: "Onyx", r: 53, g: 56, b: 57 },
  { name: "Jet", r: 52, g: 52, b: 52 },
  { name: "Obsidian", r: 28, g: 28, b: 28 },
  { name: "Smoke", r: 115, g: 130, b: 118 },
  { name: "Steel", r: 113, g: 121, b: 126 },
  { name: "Iron", r: 82, g: 82, b: 82 },
  { name: "Gunmetal", r: 42, g: 52, b: 57 },
  { name: "Titanium", r: 135, g: 134, b: 129 },
  { name: "Chrome", r: 219, g: 226, b: 233 },
  { name: "Platinum", r: 229, g: 228, b: 226 },
  { name: "Quartz", r: 217, g: 217, b: 217 },
  { name: "Opal", r: 168, g: 195, b: 188 },
  { name: "Topaz", r: 255, g: 200, b: 124 },
  { name: "Citrine", r: 228, g: 208, b: 10 },
  { name: "Jasper", r: 215, g: 59, b: 62 },
  { name: "Garnet", r: 115, g: 54, b: 53 },
  { name: "Ruby", r: 224, g: 17, b: 95 },
  { name: "Carmine", r: 150, g: 0, b: 24 },
  { name: "Copper", r: 184, g: 115, b: 51 },
  { name: "Bronze", r: 205, g: 127, b: 50 },
];

let DIM = rgba(80, 80, 90);
let SELECT_BG = rgba(40, 80, 160);
let FG = rgba(220, 220, 220);
let STATUS_BG = rgba(30, 30, 40);
let STATUS_FG = rgba(180, 180, 190);

function clamp(v: number, min: number, max: number): number {
  if (v < min) {
    return min;
  } else {
    return v > max ? max : v;
  }
}

await main(function* () {
  let { columns, rows } = Deno.stdout.isTerminal()
    ? Deno.consoleSize()
    : { columns: 80, rows: 24 };

  Deno.stdin.setRaw(true);

  let stdin = yield* useStdin();
  let input = useInput(stdin);

  let term = yield* until(createTerm({ width: columns, height: rows }));

  let tty = settings(alternateBuffer(), cursor(false), mouseTracking());
  Deno.stdout.writeSync(tty.apply);

  yield* ensure(() => {
    Deno.stdout.writeSync(tty.revert);
  });

  let selected = 0;
  let scrollY = 0;
  let viewHeight = rows - 1;
  let maxScroll = Math.max(SWATCHES.length - viewHeight, 0);

  function ensureVisible() {
    if (selected < scrollY) {
      scrollY = selected;
    } else if (selected >= scrollY + viewHeight) {
      scrollY = selected - viewHeight + 1;
    }
  }

  function buildOps(): Op[] {
    let ops: Op[] = [
      open("root", {
        layout: { width: grow(), height: grow(), direction: "ttb" },
      }),
      open("list", {
        layout: { width: grow(), height: grow(), direction: "ttb" },
        clip: { y: -scrollY },
      }),
    ];

    for (let i = 0; i < SWATCHES.length; i++) {
      let s = SWATCHES[i];
      let isSelected = i === selected;
      let bg = isSelected ? SELECT_BG : undefined;
      let idx = String(i + 1).padStart(3, " ");

      ops.push(
        open(`s${i}`, {
          layout: {
            direction: "ltr",
            height: fixed(1),
            width: grow(),
            padding: { left: 1 },
          },
          bg,
        }),
        open("", { layout: { width: fixed(4), height: fixed(1) } }),
        text(`${idx} `, { color: DIM }),
        close(),
        open("", {
          layout: { width: fixed(3), height: fixed(1) },
          bg: rgba(s.r, s.g, s.b),
        }),
        text("   "),
        close(),
        open("", {
          layout: { width: grow(), height: fixed(1), padding: { left: 1 } },
        }),
        text(s.name, { color: FG }),
        close(),
        open("", { layout: { width: fixed(14), height: fixed(1) } }),
        text(
          `rgb(${String(s.r).padStart(3)},${String(s.g).padStart(3)},${
            String(s.b).padStart(3)
          })`,
          { color: DIM },
        ),
        close(),
        close(),
      );
    }

    ops.push(close()); // list

    let s = SWATCHES[selected];
    let status = ` ${s.name}  rgb(${s.r},${s.g},${s.b})  ${
      selected + 1
    }/${SWATCHES.length}  j/k:\u2195  q:quit`;
    ops.push(
      open("status", {
        layout: {
          width: grow(),
          height: fixed(1),
          direction: "ltr",
          padding: { left: 1 },
        },
        bg: STATUS_BG,
      }),
      text(status, { color: STATUS_FG }),
      close(),
    );

    ops.push(close()); // root
    return ops;
  }

  function render(event?: InputEvent) {
    let result = term.render(buildOps(), event ? { event } : undefined);
    let list = result.info.get("list");
    if (list && list.scrollDelta.y !== 0) {
      scrollY = clamp(scrollY - Math.round(list.scrollDelta.y), 0, maxScroll);
      result = term.render(buildOps());
    }
    Deno.stdout.writeSync(result.output);
  }

  render();

  for (let event of yield* each(input)) {
    if (event.type === "keydown" && event.ctrl && event.key === "c") break;
    if (event.type === "keydown" && event.key === "q") break;

    if (event.type === "keydown") {
      switch (event.code) {
        case "j":
        case "ArrowDown":
          selected = clamp(selected + 1, 0, SWATCHES.length - 1);
          ensureVisible();
          break;
        case "k":
        case "ArrowUp":
          selected = clamp(selected - 1, 0, SWATCHES.length - 1);
          ensureVisible();
          break;
        case "d":
        case "PageDown":
          selected = clamp(
            selected + Math.floor(viewHeight / 2),
            0,
            SWATCHES.length - 1,
          );
          ensureVisible();
          break;
        case "u":
        case "PageUp":
          selected = clamp(
            selected - Math.floor(viewHeight / 2),
            0,
            SWATCHES.length - 1,
          );
          ensureVisible();
          break;
        case "g":
        case "Home":
          selected = 0;
          ensureVisible();
          break;
        case "End":
          selected = SWATCHES.length - 1;
          ensureVisible();
          break;
      }
      if ((event as InputEvent & { key: string }).key === "G") {
        selected = SWATCHES.length - 1;
        ensureVisible();
      }
    }

    if (event.type === "resize") {
      columns = event.width;
      rows = event.height;
      viewHeight = rows - 1;
      maxScroll = Math.max(SWATCHES.length - viewHeight, 0);
      scrollY = clamp(scrollY, 0, maxScroll);
      ensureVisible();
      term = yield* until(createTerm({ width: columns, height: rows }));
    }

    render(event);

    yield* each.next();
  }
});
