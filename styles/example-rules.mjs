// An example style plugin: rules of your own, for what a style file's numbers cannot say.
//
// This is code: `pnpm check` and the editor run it with your rights, as any plugin. Only list style files whose
// plugins you trust. It must sit beside its style file (or below it), and it is imported as an ES module.
//
// The default export is a list of rules, or a function returning one. The function gets the helpers rule writers use
// (`api`: eachElem, typeOf, kidsOf, valueOf, isBound, staticText, fp, isCloseButton, ...; src/core/edit/styles/
// generic.ts, PLUGIN_API) and the style file's entries for the plugin's rules. A rule is { id, title, summary,
// check(ctx, report) }: ctx has the window JSON (`win`) and its binds; report(path, text, severity?, key?) adds a note
// (path: the element's path, or null for the window). An entry under the style file's `rules` with the rule's id
// sets its enabled, severity, exempt, title and summary.

/** @param {import("../src/core/edit/styles/generic.ts").PluginApi} api */
export default function rules(api) {
  return [
    {
      id: "no-empty-window",
      title: "Not empty",
      summary: "A window has something in it.",
      check(ctx, report) {
        let n = 0;
        api.eachElem(ctx.win, () => n++);
        if (n <= 1) report(null, "the window has nothing in it", "info");
      },
    },
  ];
}
