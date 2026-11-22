/// @file   nui_touch.nss
/// @brief  NUI windows that work on desktop, Android and iOS clients.
///
/// Part of nwn-nui-designer (https://github.com/plenarius/nwn-nui-designer), under its MIT License:
///
///   MIT License
///
///   Copyright (c) 2026 plenarius
///
///   Permission is hereby granted, free of charge, to any person obtaining a copy
///   of this software and associated documentation files (the "Software"), to deal
///   in the Software without restriction, including without limitation the rights
///   to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
///   copies of the Software, and to permit persons to whom the Software is
///   furnished to do so, subject to the following conditions:
///
///   The above copyright notice and this permission notice shall be included in all
///   copies or substantial portions of the Software.
///
///   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
///   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
///   FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
///   AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
///   LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
///   OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
///   SOFTWARE.
///
/// The iOS client multiplies some NUI quantities; desktop and Android clients do not. The rules and the measurements
/// are in the nwn-nui-spec (https://github.com/plenarius/nwn-nui-spec, spec/mobile.md); the rule ids are cited below.
/// The numbers come from ONE iPhone (density d = 3, GUI scales s = 1.0 and 1.6) and ONE Android tablet, on build
/// 89.8193.37-17. Other devices and builds may differ. On iOS, two factors apply, in GUI units:
///
///   - the window's POSITION (geometry x and y) is in points: multiplied by d / s (NuiTouch_Factor, NUI-MOBILE-026);
///   - element MARGINS, a list's ROW HEIGHT, its template's CELL WIDTHS and every DRAW-LIST coordinate are multiplied
///     by d alone, whatever the GUI scale (NuiTouch_Density, NUI-MOBILE-020 to -025). A draw rect 32 high sent as
///     32 / 3 draws 32 units high at s = 1.0 and at s = 1.6.
///
/// At s = 1.0 the two are the same, which is why they were first taken as one.
///
/// How to use it:
///
///   1. When a player logs in (or changes the GUI scale), call NuiTouch_StartProbe(oPC, sEventScript, sThen). It
///      waits for the client to report its screen size, opens a small invisible window that the client clamps into
///      the screen and reports back (NUI-MOBILE-010), and runs the script sThen on oPC once the probe has answered
///      or given up (after NUI_TOUCH_PROBE_WAIT seconds): open the player's first windows from sThen, not before.
///   2. In the probe's event script sEventScript (empty: the module's NUI event script), call NuiTouch_HandleEvent()
///      first; it returns TRUE when the event was the probe's, and stores the result on the player.
///   3. Build windows through NuiTouch_Window(oPC, jWindow), and set a bound geometry with
///      NuiTouch_Rect(oPC, x, y, w, h, NuiTouch_Grown(oPC)) right after it. On a desktop or Android client, or before
///      the probe has answered, both return what they are given.
///   4. Values your script binds to draw-list coordinates: divide them by NuiTouch_Density(oPC), the size factor
///      (NuiTouch_DivGeom(jValue, NuiTouch_Density(oPC)) or NuiTouch_DrawRect), not by NuiTouch_Factor.
///
/// Give every element margin 0 and make gaps with spacers (NUI-MOBILE-021): margins are multiplied on iOS and this
/// file does not change them. nwn-nui-designer's "portable margins" export writes windows that way.
///
/// What NuiTouch_Window does on a touch client, besides dividing the multiplied quantities by the density:
///   - thin spacer cells (NUI_TOUCH_THIN_CELL wide or less) are dropped from list templates: iOS draws a cell at
///     least about 11 px wide (NUI-MOBILE-024), which would push the others;
///   - a control with a set height (button, check, text field, ...) grows by 2 (d - 1) / s, since iOS draws its
///     frame inset and its label low (NUI-MOBILE-031), and what holds it grows with it; the window grows to match;
///   - a list's (and a bordered group's) content is narrowed where it no longer fits iOS's wider inset
///     (about 14 screen pixels: 4.64 d / s units a side, NUI-MOBILE-033), and a list with no vertical scrollbar has
///     its rows lowered so they still fit;
///   - the window's size gets the iOS frame's extra (NUI-MOBILE-030) and slack, and a window at -1, -2 or -3 opens
///     at the top left instead of off-screen (NUI-MOBILE-027).

#include "nw_inc_nui"

// ---------------------------------------------------------------------------------------------------------------
// The numbers (nwn-nui-spec tables/mobile.yaml)
// ---------------------------------------------------------------------------------------------------------------

const string NUI_TOUCH_PROBE_ID = "nui_touch_probe";

// The probe window: x = y = 20000, 300 x 150 (NUI-MOBILE-010).
const float NUI_TOUCH_PROBE_XY = 20000.0;
const float NUI_TOUCH_PROBE_W = 300.0;
const float NUI_TOUCH_PROBE_H = 150.0;
// While the client has not reported its screen size: try again every NUI_TOUCH_PROBE_RETRY s, NUI_TOUCH_PROBE_TRIES
// times. Then wait up to NUI_TOUCH_PROBE_WAIT s for the probe's answer (it came within about 3 s).
const float NUI_TOUCH_PROBE_RETRY = 2.0;
const int NUI_TOUCH_PROBE_TRIES = 10;
const float NUI_TOUCH_PROBE_WAIT = 10.0;

// A client whose density differs from its GUI scale by more than this is a touch (point-based) client.
const float NUI_TOUCH_TOLERANCE = 0.25;

// Spacer cells this wide or less are dropped from list templates on a touch client: iOS draws a cell at least about
// 11 px wide (NUI-MOBILE-024), which pushes the other cells.
const float NUI_TOUCH_THIN_CELL = 4.0;

// The iOS frame's extra width and height over the desktop's 16 x 49, K / s^2 units at density 3 (NUI-MOBILE-030, a
// fit through two GUI scales; (d - 1) / 2 of it at another density), plus slack that windows needed in use.
const float NUI_TOUCH_FRAME_KW = 32.0;
const float NUI_TOUCH_FRAME_KH = 66.0;
const float NUI_TOUCH_FRAME_SLACK = 6.0;

// Where a window placed at -1, -2 or -3 opens on a touch client, in points from the top left (NUI-MOBILE-027).
const float NUI_TOUCH_CORNER = 20.0;

// How much taller a control with a set height is made, per step of density above 1, over the GUI scale
// (NUI-MOBILE-031: +4 at density 3 and s = 1.0).
const float NUI_TOUCH_EXTRA_CTRL = 2.0;
// How much further in iOS draws a button's frame on each side, per step of density above 1, over the GUI scale
// (NUI-MOBILE-032; NuiTouch_ButtonTextIn).
const float NUI_TOUCH_BTN_IN = 2.5;

// A bordered list's (or group's) inset on each side on the desktop (NUI-LIST-002), and on iOS this times d / s
// (14 px at density 3, NUI-MOBILE-033), with slack so cells that only just fit are not clipped.
const float NUI_TOUCH_LIST_IN = 4.0;
const float NUI_TOUCH_LIST_IN_IOS = 4.64;
const float NUI_TOUCH_LIST_SLACK = 3.0;
// The scrollbar a list or a group takes from its content (the default skin's), and the space between a list's rows
// on the desktop (NUI-LIST-003).
const float NUI_TOUCH_SCROLLBAR_W = 18.0;
const float NUI_TOUCH_ROW_SPACING = 4.0;

// NuiList's row height when the JSON has none.
const float NUI_TOUCH_ROW_HEIGHT = 25.0;

// Local variables on the player.
const string NUI_TOUCH_VAR_D = "NUI_TOUCH_D";
const string NUI_TOUCH_VAR_S = "NUI_TOUCH_S";
const string NUI_TOUCH_VAR_TOUCH = "NUI_TOUCH";
const string NUI_TOUCH_VAR_DONE = "NUI_TOUCH_DONE";
const string NUI_TOUCH_VAR_RUN = "NUI_TOUCH_RUN";
const string NUI_TOUCH_VAR_SCRIPT = "NUI_TOUCH_SCRIPT";
const string NUI_TOUCH_VAR_THEN = "NUI_TOUCH_THEN";
const string NUI_TOUCH_VAR_GROWN = "NUI_TOUCH_GROWN";

// ---------------------------------------------------------------------------------------------------------------
// Declarations
// ---------------------------------------------------------------------------------------------------------------

/// The player's GUI scale s: gui_scale / 100, a scale of 0 or none counting as 1 (Android reports 0, NUI-MOBILE-040).
float NuiTouch_Scale(object oPC);

/// Measures oPC's client with the density probe (NUI-MOBILE-010). sEventScript: the script that gets the probe's
/// events (empty: the module's NUI event script); it must call NuiTouch_HandleEvent(). sThen: a script run on oPC
/// once, when the probe has answered or given up, so windows are never opened before the answer. A later call
/// replaces a probe still running.
void NuiTouch_StartProbe(object oPC, string sEventScript = "", string sThen = "");

/// In an NUI event script: when the event is the probe's report, works the density out, stores it on the player,
/// closes the probe, runs the probe's sThen and returns TRUE. Returns FALSE for every other event.
int NuiTouch_HandleEvent();

/// TRUE once the probe has answered for the player's current GUI scale.
int NuiTouch_Known(object oPC);

/// TRUE when the probe found a touch (point-based) client: |d - s| > 0.25.
int NuiTouch_IsTouch(object oPC);

/// The position factor d / s: what iOS multiplies the window's position (geometry x, y) by (NUI-MOBILE-026). 1.0 on
/// desktop and Android, and until the probe has answered.
float NuiTouch_Factor(object oPC);

/// The size factor d, the screen's pixels a point: what iOS multiplies margins, row heights, cell widths and
/// draw-list coordinates by, whatever the GUI scale (NUI-MOBILE-020 to -025). 1.0 on desktop and Android, and until
/// the probe has answered.
float NuiTouch_Density(object oPC);

/// A number, a rect or vector object ({x, y, w, h}), or an array of them, divided by fDiv. Binds are left alone.
/// For draw-list values a script binds, pass NuiTouch_Density(oPC) as fDiv.
json NuiTouch_DivGeom(json jValue, float fDiv);

/// NuiRect(fX, fY, fW, fH) for a draw-list rect a script binds, divided by oPC's density.
json NuiTouch_DrawRect(object oPC, float fX, float fY, float fW, float fH);

/// How much taller oPC's client needs a control with a set height: 2 (d - 1) / s; 0.0 on desktop-like clients.
float NuiTouch_ControlGrowth(object oPC);

/// How much further left text a script draws right-aligned at a button's inner edge must go to clear the button's
/// frame on oPC's client: 2.5 (d - 1) / s; 0.0 on desktop-like clients.
float NuiTouch_ButtonTextIn(object oPC);

/// How much further in a bordered list (or group) draws its content on each side on oPC's client than on the
/// desktop, with slack: 4.64 d / s - 4 + 3; 0.0 on desktop-like clients.
float NuiTouch_ListInsetExtra(object oPC);

/// How much narrower cells fWidth wide in all must be on oPC's client to fit a bordered list fListW wide with
/// scrollbars nScroll, once its wider inset is taken off. 0.0 on desktop-like clients and when they still fit. A
/// script drawing at a place it works out from a list's width takes it off too.
float NuiTouch_ListCut(object oPC, float fListW, float fWidth, int nScroll = NUI_SCROLLBARS_Y);

/// jElem (an element or a window) with every control with a set height fGrow taller and what holds it with it: a row
/// and a group by their tallest child's growth, a column by the sum of its children's, a list's rows by their
/// tallest cell's. NuiTouch_LastGrowth() then returns how much taller jElem (a window: its root) became.
json NuiTouch_GrowControls(json jElem, float fGrow);

/// What the last NuiTouch_GrowControls made its element taller by.
float NuiTouch_LastGrowth();

/// jElem (an element) fCut narrower: its set width, and inside it what no longer fits (a row's widest child, a
/// column's or a group's children wider than it, a list's variable cell, else its widest). Drawn items in its right
/// half move left with it, those reaching its right edge end that much sooner.
json NuiTouch_Narrow(json jElem, float fCut);

/// jLayout (an element or a window) with every list's cells and every bordered group's content narrowed by what
/// they lack once their inset is fSide wider on each side, and every list with no vertical scrollbar with its rows
/// lowered where they no longer fit inside that inset (NuiTouch_FitRows).
json NuiTouch_NarrowLists(json jLayout, float fSide);

/// jList, a list with no vertical scrollbar, with its row_height lowered so that the rows it shows whole on the
/// desktop still fit once its inset is fSide more at the top and the bottom.
json NuiTouch_FitRows(json jList, float fSide);

/// An element and everything in it, for oPC: controls with a set height grown (NuiTouch_GrowControls), lists'
/// cells narrowed to the wider inset (NuiTouch_NarrowLists), then list row heights and template cell widths and
/// draw-list coordinates divided by the density, thin spacer cells dropped (NUI-MOBILE-022 to -025, -031, -033).
/// NuiTouch_Grown(oPC) then returns how much taller it became. Unchanged on desktop-like clients.
json NuiTouch_Layout(object oPC, json jElem);

/// How much taller the last NuiTouch_Layout or NuiTouch_Window for oPC made its layout (0.0 on desktop-like
/// clients): pass it to NuiTouch_Rect for that window's bound geometry.
float NuiTouch_Grown(object oPC);

/// A window for oPC: its layout through NuiTouch_Layout, a static geometry through NuiTouch_Rect (grown with its
/// controls), and a static size_constraint grown as its size. A bound geometry is left alone: set its value with
/// NuiTouch_Rect(oPC, x, y, w, h, NuiTouch_Grown(oPC)) right after. Unchanged on desktop-like clients.
json NuiTouch_Window(object oPC, json jWindow);

/// The geometry for oPC: on a touch client the position divided by the position factor d / s (NUI-MOBILE-026), a
/// window at -1, -2 or -3 put at the top left instead (centring lands off-screen on iOS, NUI-MOBILE-027), and the
/// size grown by the frame's extra and slack (NUI-MOBILE-030) and fGrown (NuiTouch_Grown) in height. Unchanged on
/// desktop-like clients.
json NuiTouch_Rect(object oPC, float fX, float fY, float fW, float fH, float fGrown = 0.0);

/// The extra width (bHeight FALSE) or height (TRUE) a window needs on oPC's client for the iOS frame, slack
/// included; 0.0 on desktop-like clients.
float NuiTouch_FrameExtra(object oPC, int bHeight);

// ---------------------------------------------------------------------------------------------------------------
// The probe
// ---------------------------------------------------------------------------------------------------------------

float NuiTouch_Scale(object oPC)
{
    int nScale = GetPlayerDeviceProperty(oPC, PLAYER_DEVICE_PROPERTY_GUI_SCALE);
    if (nScale <= 0)
        return 1.0;
    return IntToFloat(nScale) / 100.0;
}

void _NuiTouch_EndProbe(object oPC)
{
    int nToken = NuiFindWindow(oPC, NUI_TOUCH_PROBE_ID);
    if (nToken != 0)
        NuiDestroy(oPC, nToken);
}

// Ends oPC's probe run: runs the script waiting for it, once.
void _NuiTouch_Then(object oPC)
{
    string sThen = GetLocalString(oPC, NUI_TOUCH_VAR_THEN);
    if (sThen == "")
        return;
    DeleteLocalString(oPC, NUI_TOUCH_VAR_THEN);
    ExecuteScript(sThen, oPC);
}

// Gives up on run nRun of oPC's probe if it has not answered: oPC stays as it was (desktop if never measured).
void _NuiTouch_Timeout(object oPC, int nRun)
{
    if (!GetIsObjectValid(oPC) || GetLocalInt(oPC, NUI_TOUCH_VAR_RUN) != nRun)
        return;
    _NuiTouch_EndProbe(oPC);
    _NuiTouch_Then(oPC);
}

// Opens run nRun's probe window on oPC once the client has reported its screen size (try nTry).
void _NuiTouch_Try(object oPC, int nRun, int nTry)
{
    if (!GetIsObjectValid(oPC) || GetLocalInt(oPC, NUI_TOUCH_VAR_RUN) != nRun)
        return;
    if (GetPlayerDeviceProperty(oPC, PLAYER_DEVICE_PROPERTY_GUI_WIDTH) <= 0)
    {
        if (nTry < NUI_TOUCH_PROBE_TRIES)
            DelayCommand(NUI_TOUCH_PROBE_RETRY, _NuiTouch_Try(oPC, nRun, nTry + 1));
        else
            _NuiTouch_Then(oPC);
        return;
    }
    _NuiTouch_EndProbe(oPC);
    json jWin = NuiWindow(NuiCol(JsonArray()), JsonBool(FALSE), NuiBind("geometry"), JsonBool(FALSE), JsonBool(FALSE),
                          JsonBool(FALSE), JsonBool(TRUE), JsonBool(FALSE), JsonBool(FALSE));
    int nToken = NuiCreate(oPC, jWin, NUI_TOUCH_PROBE_ID, GetLocalString(oPC, NUI_TOUCH_VAR_SCRIPT));
    if (nToken == 0)
    {
        _NuiTouch_Then(oPC);
        return;
    }
    // Far past the screen: the client clamps it into the bottom-right corner and reports that place.
    NuiSetBind(oPC, nToken, "geometry", NuiRect(NUI_TOUCH_PROBE_XY, NUI_TOUCH_PROBE_XY, NUI_TOUCH_PROBE_W, NUI_TOUCH_PROBE_H));
    NuiSetBindWatch(oPC, nToken, "geometry", TRUE);
    DelayCommand(NUI_TOUCH_PROBE_WAIT, _NuiTouch_Timeout(oPC, nRun));
}

void NuiTouch_StartProbe(object oPC, string sEventScript = "", string sThen = "")
{
    if (!GetIsPC(oPC))
    {
        if (sThen != "")
            ExecuteScript(sThen, oPC);
        return;
    }
    if (sThen != "")
        SetLocalString(oPC, NUI_TOUCH_VAR_THEN, sThen);
    SetLocalString(oPC, NUI_TOUCH_VAR_SCRIPT, sEventScript);
    int nRun = GetLocalInt(oPC, NUI_TOUCH_VAR_RUN) + 1;
    SetLocalInt(oPC, NUI_TOUCH_VAR_RUN, nRun);
    // A moment's wait, so a burst of device property events makes one probe. Run by the module, which stays.
    AssignCommand(GetModule(), DelayCommand(0.5, _NuiTouch_Try(oPC, nRun, 0)));
}

int NuiTouch_HandleEvent()
{
    object oPC = NuiGetEventPlayer();
    int nToken = NuiGetEventWindow();
    if (NuiGetWindowId(oPC, nToken) != NUI_TOUCH_PROBE_ID)
        return FALSE;
    if (NuiGetEventType() != "watch" || NuiGetEventElement() != "geometry")
        return TRUE;
    json jGeo = NuiGetBind(oPC, nToken, "geometry");
    float fX = JsonGetFloat(JsonObjectGet(jGeo, "x"));
    float fGuiW = IntToFloat(GetPlayerDeviceProperty(oPC, PLAYER_DEVICE_PROPERTY_GUI_WIDTH));
    // Not clamped yet (the echo of our own value), nonsense, or no screen size: wait for the next report.
    if (fX <= 0.0 || fX >= NUI_TOUCH_PROBE_XY / 2.0 || fGuiW <= 0.0)
        return TRUE;
    float fS = NuiTouch_Scale(oPC);
    float fW = JsonGetFloat(JsonObjectGet(jGeo, "w"));
    if (fW <= 0.0)
        fW = NUI_TOUCH_PROBE_W;
    // d = (gui_width - w * s) / x_reported (NUI-MOBILE-011): s on the desktop (GUI units), the density on iOS (points).
    float fD = (fGuiW - fW * fS) / fX;
    if (fD <= 0.0)
        fD = fS;
    int bTouch = fabs(fD - fS) > NUI_TOUCH_TOLERANCE;
    // To the nearest half, 1 to 4.
    fD = IntToFloat(FloatToInt(fD * 2.0 + 0.5)) / 2.0;
    if (fD < 1.0)
        fD = 1.0;
    if (fD > 4.0)
        fD = 4.0;
    SetLocalFloat(oPC, NUI_TOUCH_VAR_D, fD);
    SetLocalFloat(oPC, NUI_TOUCH_VAR_S, fS);
    SetLocalInt(oPC, NUI_TOUCH_VAR_TOUCH, bTouch);
    SetLocalInt(oPC, NUI_TOUCH_VAR_DONE, TRUE);
    NuiDestroy(oPC, nToken);
    // Answered: the run's timeout no longer applies.
    SetLocalInt(oPC, NUI_TOUCH_VAR_RUN, GetLocalInt(oPC, NUI_TOUCH_VAR_RUN) + 1);
    _NuiTouch_Then(oPC);
    return TRUE;
}

int NuiTouch_Known(object oPC)
{
    return GetLocalInt(oPC, NUI_TOUCH_VAR_DONE) && fabs(GetLocalFloat(oPC, NUI_TOUCH_VAR_S) - NuiTouch_Scale(oPC)) < 0.001;
}

int NuiTouch_IsTouch(object oPC)
{
    return NuiTouch_Known(oPC) && GetLocalInt(oPC, NUI_TOUCH_VAR_TOUCH);
}

float NuiTouch_Density(object oPC)
{
    if (!NuiTouch_IsTouch(oPC))
        return 1.0;
    float fD = GetLocalFloat(oPC, NUI_TOUCH_VAR_D);
    return fD > 0.0 ? fD : 1.0;
}

float NuiTouch_Factor(object oPC)
{
    if (!NuiTouch_IsTouch(oPC))
        return 1.0;
    return NuiTouch_Density(oPC) / GetLocalFloat(oPC, NUI_TOUCH_VAR_S);
}

float NuiTouch_ControlGrowth(object oPC)
{
    return NUI_TOUCH_EXTRA_CTRL * (NuiTouch_Density(oPC) - 1.0) / NuiTouch_Scale(oPC);
}

float NuiTouch_ButtonTextIn(object oPC)
{
    return NUI_TOUCH_BTN_IN * (NuiTouch_Density(oPC) - 1.0) / NuiTouch_Scale(oPC);
}

float NuiTouch_ListInsetExtra(object oPC)
{
    float fD = NuiTouch_Density(oPC);
    if (fD == 1.0)
        return 0.0;
    float fExtra = NUI_TOUCH_LIST_IN_IOS * fD / NuiTouch_Scale(oPC) - NUI_TOUCH_LIST_IN + NUI_TOUCH_LIST_SLACK;
    return fExtra > 0.0 ? fExtra : 0.0;
}

float NuiTouch_FrameExtra(object oPC, int bHeight)
{
    if (!NuiTouch_IsTouch(oPC))
        return 0.0;
    float fS = GetLocalFloat(oPC, NUI_TOUCH_VAR_S);
    // Measured at density 3; scaled by (d - 1) / 2 at another density (an assumption: not measured).
    float fK = (bHeight ? NUI_TOUCH_FRAME_KH : NUI_TOUCH_FRAME_KW) * (NuiTouch_Density(oPC) - 1.0) / 2.0;
    if (fK < 0.0)
        fK = 0.0;
    return fK / (fS * fS) + NUI_TOUCH_FRAME_SLACK;
}

// ---------------------------------------------------------------------------------------------------------------
// Reading elements
// ---------------------------------------------------------------------------------------------------------------

int _NuiTouch_IsNumber(json jValue)
{
    int nType = JsonGetType(jValue);
    return nType == JSON_TYPE_INTEGER || nType == JSON_TYPE_FLOAT;
}

// jElem's number sKey, or fDefault if it has none (or a bind).
float _NuiTouch_Number(json jElem, string sKey, float fDefault)
{
    json jValue = JsonObjectGet(jElem, sKey);
    return _NuiTouch_IsNumber(jValue) ? JsonGetFloat(jValue) : fDefault;
}

// jElem's set width (bWidth) or height, or -1.0 if it has none.
float _NuiTouch_Fixed(json jElem, int bWidth)
{
    return _NuiTouch_Number(jElem, bWidth ? "width" : "height", -1.0);
}

// The room jElem's margins take along one axis: its own margin, else the client's default (2; 0 for a spacer, a
// tabbar or options), twice.
float _NuiTouch_Margins(json jElem)
{
    float fMargin = _NuiTouch_Number(jElem, "margin", -1.0);
    if (fMargin < 0.0)
    {
        string sType = JsonGetString(JsonObjectGet(jElem, "type"));
        fMargin = sType == "spacer" || sType == "tabbar" || sType == "options" ? 0.0 : 2.0;
    }
    return 2.0 * fMargin;
}

// TRUE when jElem has a border (the default) or sets it TRUE.
int _NuiTouch_Border(json jElem)
{
    json jBorder = JsonObjectGet(jElem, "border");
    return JsonGetType(jBorder) != JSON_TYPE_BOOL || JsonGetInt(jBorder);
}

// jElem's scrollbars, nDefault if it sets none (or binds them).
int _NuiTouch_Scrollbars(json jElem, int nDefault)
{
    json jScroll = JsonObjectGet(jElem, "scrollbars");
    return JsonGetType(jScroll) == JSON_TYPE_INTEGER ? JsonGetInt(jScroll) : nDefault;
}

// ---------------------------------------------------------------------------------------------------------------
// Dividing by the density
// ---------------------------------------------------------------------------------------------------------------

json NuiTouch_DivGeom(json jValue, float fDiv)
{
    int nType = JsonGetType(jValue);
    if (nType == JSON_TYPE_INTEGER || nType == JSON_TYPE_FLOAT)
        return JsonFloat(JsonGetFloat(jValue) / fDiv);
    if (nType == JSON_TYPE_ARRAY)
    {
        int i;
        int n = JsonGetLength(jValue);
        for (i = 0; i < n; i++)
            jValue = JsonArraySet(jValue, i, NuiTouch_DivGeom(JsonArrayGet(jValue, i), fDiv));
        return jValue;
    }
    if (nType == JSON_TYPE_OBJECT && JsonGetType(JsonObjectGet(jValue, "bind")) == JSON_TYPE_NULL)
    {
        json jKeys = JsonParse("[\"x\",\"y\",\"w\",\"h\"]");
        int i;
        for (i = 0; i < 4; i++)
        {
            string sKey = JsonGetString(JsonArrayGet(jKeys, i));
            json jPart = JsonObjectGet(jValue, sKey);
            if (_NuiTouch_IsNumber(jPart))
                jValue = JsonObjectSet(jValue, sKey, JsonFloat(JsonGetFloat(jPart) / fDiv));
        }
    }
    return jValue;
}

json NuiTouch_DrawRect(object oPC, float fX, float fY, float fW, float fH)
{
    float fD = NuiTouch_Density(oPC);
    return NuiRect(fX / fD, fY / fD, fW / fD, fH / fD);
}

// A draw-list item with its coordinates and sizes divided (NUI-MOBILE-025): not the glyph size or the image region
// (texels). A line's thickness is divided too, but not below 1 (or its own, if thinner), so a line never fades out.
json _NuiTouch_DrawItem(json jItem, float fDiv)
{
    if (JsonGetType(jItem) != JSON_TYPE_OBJECT)
        return jItem;
    json jKeys = JsonParse("[\"rect\",\"points\",\"a\",\"b\",\"c\",\"ctrl0\",\"ctrl1\",\"radius\"]");
    int i;
    int n = JsonGetLength(jKeys);
    for (i = 0; i < n; i++)
    {
        string sKey = JsonGetString(JsonArrayGet(jKeys, i));
        json jPart = JsonObjectGet(jItem, sKey);
        if (JsonGetType(jPart) != JSON_TYPE_NULL)
            jItem = JsonObjectSet(jItem, sKey, NuiTouch_DivGeom(jPart, fDiv));
    }
    json jThick = JsonObjectGet(jItem, "line_thickness");
    if (_NuiTouch_IsNumber(jThick))
    {
        float fThick = JsonGetFloat(jThick);
        float fLeast = fThick < 1.0 ? fThick : 1.0;
        float fNew = fThick / fDiv;
        jItem = JsonObjectSet(jItem, "line_thickness", JsonFloat(fNew < fLeast ? fLeast : fNew));
    }
    return jItem;
}

// jElem with every list's row_height and cell widths and every draw list's geometry divided by fDiv, and thin
// spacer cells dropped from list templates (NUI-MOBILE-022 to -025).
json _NuiTouch_Divide(json jElem, float fDiv)
{
    if (JsonGetType(jElem) != JSON_TYPE_OBJECT)
        return jElem;
    int i;
    int n;
    json jKids = JsonObjectGet(jElem, "children");
    if (JsonGetType(jKids) == JSON_TYPE_ARRAY)
    {
        n = JsonGetLength(jKids);
        for (i = 0; i < n; i++)
            jKids = JsonArraySet(jKids, i, _NuiTouch_Divide(JsonArrayGet(jKids, i), fDiv));
        jElem = JsonObjectSet(jElem, "children", jKids);
    }
    if (JsonGetString(JsonObjectGet(jElem, "type")) == "list")
    {
        jElem = JsonObjectSet(jElem, "row_height", JsonFloat(_NuiTouch_Number(jElem, "row_height", NUI_TOUCH_ROW_HEIGHT) / fDiv));
        json jTemplate = JsonObjectGet(jElem, "row_template");
        if (JsonGetType(jTemplate) == JSON_TYPE_ARRAY)
        {
            json jCells = JsonArray();
            n = JsonGetLength(jTemplate);
            for (i = 0; i < n; i++)
            {
                json jCell = JsonArrayGet(jTemplate, i);
                json jIn = JsonArrayGet(jCell, 0);
                json jWidth = JsonArrayGet(jCell, 1);
                if (n > 1 && JsonGetString(JsonObjectGet(jIn, "type")) == "spacer" && _NuiTouch_IsNumber(jWidth) &&
                    JsonGetFloat(jWidth) <= NUI_TOUCH_THIN_CELL)
                    continue;
                jCell = JsonArraySet(jCell, 0, _NuiTouch_Divide(jIn, fDiv));
                if (_NuiTouch_IsNumber(jWidth))
                    jCell = JsonArraySet(jCell, 1, JsonFloat(JsonGetFloat(jWidth) / fDiv));
                jCells = JsonArrayInsert(jCells, jCell);
            }
            jElem = JsonObjectSet(jElem, "row_template", jCells);
        }
    }
    json jDraw = JsonObjectGet(jElem, "draw_list");
    if (JsonGetType(jDraw) == JSON_TYPE_ARRAY)
    {
        n = JsonGetLength(jDraw);
        for (i = 0; i < n; i++)
            jDraw = JsonArraySet(jDraw, i, _NuiTouch_DrawItem(JsonArrayGet(jDraw, i), fDiv));
        jElem = JsonObjectSet(jElem, "draw_list", jDraw);
    }
    return jElem;
}

// ---------------------------------------------------------------------------------------------------------------
// Taller controls (NUI-MOBILE-031)
// ---------------------------------------------------------------------------------------------------------------

// What the last NuiTouch_GrowControls made its element taller by (NWScript returns one value).
float _NUI_TOUCH_GROWTH;

float NuiTouch_LastGrowth()
{
    return _NUI_TOUCH_GROWTH;
}

// TRUE if sType is a control whose label iOS draws low when its height is set.
int _NuiTouch_IsControl(string sType)
{
    return sType == "button" || sType == "button_select" || sType == "combo" ||
           sType == "check" || sType == "textedit" || sType == "slider" || sType == "sliderf" || sType == "tabbar";
}

json NuiTouch_GrowControls(json jElem, float fGrow)
{
    _NUI_TOUCH_GROWTH = 0.0;
    if (JsonGetType(jElem) != JSON_TYPE_OBJECT || fGrow <= 0.0)
        return jElem;
    json jRoot = JsonObjectGet(jElem, "root");
    if (JsonGetType(jRoot) == JSON_TYPE_OBJECT)
    {
        jRoot = NuiTouch_GrowControls(jRoot, fGrow);
        float fRoot = _NUI_TOUCH_GROWTH;
        jElem = JsonObjectSet(jElem, "root", jRoot);
        _NUI_TOUCH_GROWTH = fRoot;
        return jElem;
    }
    string sType = JsonGetString(JsonObjectGet(jElem, "type"));
    float fHeight = _NuiTouch_Fixed(jElem, FALSE);
    float fGrown = 0.0;
    if (_NuiTouch_IsControl(sType) && fHeight >= 0.0)
        fGrown = fGrow;
    int i;
    json jKids = JsonObjectGet(jElem, "children");
    if (JsonGetType(jKids) == JSON_TYPE_ARRAY)
    {
        // A column stacks its children: their growth adds up. A row and a group take the most of it.
        int bCol = sType == "col";
        for (i = 0; i < JsonGetLength(jKids); i++)
        {
            jKids = JsonArraySet(jKids, i, NuiTouch_GrowControls(JsonArrayGet(jKids, i), fGrow));
            if (bCol)
                fGrown += _NUI_TOUCH_GROWTH;
            else if (_NUI_TOUCH_GROWTH > fGrown)
                fGrown = _NUI_TOUCH_GROWTH;
        }
        jElem = JsonObjectSet(jElem, "children", jKids);
    }
    json jTemplate = JsonObjectGet(jElem, "row_template");
    if (JsonGetType(jTemplate) == JSON_TYPE_ARRAY)
    {
        // A list's rows grow by their tallest cell's growth; the list itself scrolls, so keeps its height.
        float fRowGrown = 0.0;
        for (i = 0; i < JsonGetLength(jTemplate); i++)
        {
            json jCell = JsonArrayGet(jTemplate, i);
            jTemplate = JsonArraySet(jTemplate, i, JsonArraySet(jCell, 0, NuiTouch_GrowControls(JsonArrayGet(jCell, 0), fGrow)));
            if (_NUI_TOUCH_GROWTH > fRowGrown)
                fRowGrown = _NUI_TOUCH_GROWTH;
        }
        jElem = JsonObjectSet(jElem, "row_template", jTemplate);
        if (fRowGrown > 0.0)
            jElem = JsonObjectSet(jElem, "row_height",
                                  JsonFloat(_NuiTouch_Number(jElem, "row_height", NUI_TOUCH_ROW_HEIGHT) + fRowGrown));
        fGrown = 0.0;
    }
    if (fHeight >= 0.0 && fGrown > 0.0)
        jElem = JsonObjectSet(jElem, "height", JsonFloat(fHeight + fGrown));
    _NUI_TOUCH_GROWTH = fGrown;
    return jElem;
}

// ---------------------------------------------------------------------------------------------------------------
// The wider list inset (NUI-MOBILE-033)
// ---------------------------------------------------------------------------------------------------------------

// The sum of a row template's cell widths.
float _NuiTouch_SumWidths(json jCells)
{
    float fSum = 0.0;
    int i;
    for (i = 0; i < JsonGetLength(jCells); i++)
        fSum += JsonGetFloat(JsonArrayGet(JsonArrayGet(jCells, i), 1));
    return fSum;
}

// What a list fW wide with scrollbars nScroll leaves its cells, with an inset of fIn a side.
float _NuiTouch_ListRoom(float fW, int nScroll, float fIn)
{
    int bBar = nScroll == NUI_SCROLLBARS_Y || nScroll == NUI_SCROLLBARS_BOTH || nScroll == NUI_SCROLLBARS_AUTO;
    return fW - 2.0 * fIn - (bBar ? NUI_TOUCH_SCROLLBAR_W : 0.0);
}

float NuiTouch_ListCut(object oPC, float fListW, float fWidth, int nScroll = NUI_SCROLLBARS_Y)
{
    if (NuiTouch_Density(oPC) == 1.0)
        return 0.0;
    float fLack = fWidth - _NuiTouch_ListRoom(fListW, nScroll, NUI_TOUCH_LIST_IN + NuiTouch_ListInsetExtra(oPC));
    return fLack > 0.0 ? fLack : 0.0;
}

// jPos (a rect or a vec) of a drawn item in an element fW wide narrowed by fCut: moved left if it starts in the
// right half, its end brought in if it reaches the right edge (within 8).
json _NuiTouch_NarrowPos(json jPos, float fW, float fCut)
{
    if (JsonGetType(jPos) != JSON_TYPE_OBJECT || !_NuiTouch_IsNumber(JsonObjectGet(jPos, "x")))
        return jPos;
    float fX = JsonGetFloat(JsonObjectGet(jPos, "x"));
    json jW = JsonObjectGet(jPos, "w");
    if (fX >= fW / 2.0)
        return JsonObjectSet(jPos, "x", JsonFloat(fX - fCut));
    if (_NuiTouch_IsNumber(jW) && fX + JsonGetFloat(jW) > fW - 8.0)
    {
        float fNew = JsonGetFloat(jW) - fCut;
        return JsonObjectSet(jPos, "w", JsonFloat(fNew > 0.0 ? fNew : 0.0));
    }
    return jPos;
}

// jElem with its draw list's items placed for the element fW wide narrowed by fCut.
json _NuiTouch_NarrowDraw(json jElem, float fW, float fCut)
{
    json jDraw = JsonObjectGet(jElem, "draw_list");
    if (JsonGetType(jDraw) != JSON_TYPE_ARRAY || fW <= 0.0)
        return jElem;
    int i;
    for (i = 0; i < JsonGetLength(jDraw); i++)
    {
        json jItem = JsonArrayGet(jDraw, i);
        if (JsonGetType(jItem) != JSON_TYPE_OBJECT)
            continue;
        if (JsonGetInt(JsonObjectGet(jItem, "type")) == NUI_DRAW_LIST_ITEM_TYPE_LINE)
        {
            // A line: each end on its own (one reaching the right edge comes in).
            json jA = JsonObjectGet(jItem, "a");
            json jB = JsonObjectGet(jItem, "b");
            float fAX = JsonGetFloat(JsonObjectGet(jA, "x"));
            float fBX = JsonGetFloat(JsonObjectGet(jB, "x"));
            int bRight = fAX >= fW / 2.0 && fBX >= fW / 2.0;
            if (_NuiTouch_IsNumber(JsonObjectGet(jA, "x")) && (bRight || fAX > fW - 8.0))
                jItem = JsonObjectSet(jItem, "a", JsonObjectSet(jA, "x", JsonFloat(fAX - fCut)));
            if (_NuiTouch_IsNumber(JsonObjectGet(jB, "x")) && (bRight || fBX > fW - 8.0))
                jItem = JsonObjectSet(jItem, "b", JsonObjectSet(jB, "x", JsonFloat(fBX - fCut)));
        }
        else if (JsonGetType(JsonObjectGet(jItem, "rect")) != JSON_TYPE_NULL)
            jItem = JsonObjectSet(jItem, "rect", _NuiTouch_NarrowPos(JsonObjectGet(jItem, "rect"), fW, fCut));
        jDraw = JsonArraySet(jDraw, i, jItem);
    }
    return JsonObjectSet(jElem, "draw_list", jDraw);
}

// jTemplate (a list's row template) with cell nCell fCut narrower, and what is in it.
json _NuiTouch_NarrowCell(json jTemplate, int nCell, float fCut)
{
    json jCell = JsonArrayGet(jTemplate, nCell);
    float fW = JsonGetFloat(JsonArrayGet(jCell, 1));
    float fNew = fW - fCut;
    jCell = JsonArraySet(jCell, 1, JsonFloat(fNew > 0.0 ? fNew : 0.0));
    // What is in the cell spans it: narrowed as an element of the cell's width.
    json jIn = JsonArrayGet(jCell, 0);
    int bOwnW = _NuiTouch_Fixed(jIn, TRUE) >= 0.0;
    if (!bOwnW)
        jIn = JsonObjectSet(jIn, "width", JsonFloat(fW));
    jIn = NuiTouch_Narrow(jIn, fCut);
    if (!bOwnW)
        jIn = JsonObjectDel(jIn, "width");
    return JsonArraySet(jTemplate, nCell, JsonArraySet(jCell, 0, jIn));
}

// jList with its cells fCut narrower in all: its variable cell's first (down to nothing), the rest its widest's.
json _NuiTouch_NarrowCells(json jList, float fCut)
{
    json jTemplate = JsonObjectGet(jList, "row_template");
    int nCells = JsonGetLength(jTemplate);
    if (fCut <= 0.0 || JsonGetType(jTemplate) != JSON_TYPE_ARRAY || nCells == 0)
        return jList;
    int i;
    int nWidest = -1;
    int nVariable = -1;
    float fWidest = -1.0;
    for (i = 0; i < nCells; i++)
    {
        json jCell = JsonArrayGet(jTemplate, i);
        float fW = JsonGetFloat(JsonArrayGet(jCell, 1));
        if (nVariable < 0 && JsonGetType(JsonArrayGet(jCell, 2)) == JSON_TYPE_BOOL && JsonGetInt(JsonArrayGet(jCell, 2)))
            nVariable = i;
        else if (fW > fWidest)
        {
            fWidest = fW;
            nWidest = i;
        }
    }
    if (nVariable >= 0)
    {
        float fVar = JsonGetFloat(JsonArrayGet(JsonArrayGet(jTemplate, nVariable), 1));
        float fTake = fCut < fVar ? fCut : fVar;
        jTemplate = _NuiTouch_NarrowCell(jTemplate, nVariable, fTake);
        fCut -= fTake;
    }
    if (fCut > 0.0 && nWidest >= 0)
        jTemplate = _NuiTouch_NarrowCell(jTemplate, nWidest, fCut);
    return JsonObjectSet(jList, "row_template", jTemplate);
}

json NuiTouch_Narrow(json jElem, float fCut)
{
    if (fCut <= 0.0 || JsonGetType(jElem) != JSON_TYPE_OBJECT)
        return jElem;
    float fW = _NuiTouch_Fixed(jElem, TRUE);
    if (fW >= 0.0)
    {
        jElem = JsonObjectSet(jElem, "width", JsonFloat(fW > fCut ? fW - fCut : 0.0));
        jElem = _NuiTouch_NarrowDraw(jElem, fW, fCut);
    }
    string sType = JsonGetString(JsonObjectGet(jElem, "type"));
    if (sType == "list")
        return _NuiTouch_NarrowCells(jElem, fCut);
    json jKids = JsonObjectGet(jElem, "children");
    int nKids = JsonGetLength(jKids);
    if (JsonGetType(jKids) != JSON_TYPE_ARRAY || nKids == 0)
        return jElem;
    int i;
    if (sType == "row")
    {
        // A child with no set width takes up the cut; else the widest gives it.
        int nWidest = -1;
        float fWidest = -1.0;
        for (i = 0; i < nKids; i++)
        {
            float fKid = _NuiTouch_Fixed(JsonArrayGet(jKids, i), TRUE);
            if (fKid < 0.0)
                return jElem;
            if (fKid > fWidest)
            {
                fWidest = fKid;
                nWidest = i;
            }
        }
        return JsonObjectSet(jElem, "children", JsonArraySet(jKids, nWidest, NuiTouch_Narrow(JsonArrayGet(jKids, nWidest), fCut)));
    }
    // A column or a group: every child as wide as it (or with no set width) comes in; a narrower one only as far as
    // it no longer fits.
    float fNewW = fW - fCut;
    for (i = 0; i < nKids; i++)
    {
        json jKid = JsonArrayGet(jKids, i);
        float fKid = _NuiTouch_Fixed(jKid, TRUE);
        float fKidCut = fCut;
        if (fW >= 0.0 && fKid >= 0.0)
            fKidCut = fKid + _NuiTouch_Margins(jKid) - fNewW;
        if (fKidCut > fCut)
            fKidCut = fCut;
        jKids = JsonArraySet(jKids, i, NuiTouch_Narrow(jKid, fKidCut));
    }
    return JsonObjectSet(jElem, "children", jKids);
}

json NuiTouch_FitRows(json jList, float fSide)
{
    if (fSide <= 0.0 || JsonGetString(JsonObjectGet(jList, "type")) != "list")
        return jList;
    int nScroll = _NuiTouch_Scrollbars(jList, NUI_SCROLLBARS_Y);
    float fH = _NuiTouch_Fixed(jList, FALSE);
    float fRow = _NuiTouch_Number(jList, "row_height", NUI_TOUCH_ROW_HEIGHT);
    if ((nScroll != NUI_SCROLLBARS_NONE && nScroll != NUI_SCROLLBARS_X) || fH < 0.0 || fRow <= 0.0)
        return jList;
    float fIn = _NuiTouch_Border(jList) ? NUI_TOUCH_LIST_IN : 0.0;
    int nRows = FloatToInt((fH - 2.0 * fIn + NUI_TOUCH_ROW_SPACING) / (fRow + NUI_TOUCH_ROW_SPACING));
    if (nRows < 1)
        return jList;
    float fFit = (fH - 2.0 * (fIn + fSide) + NUI_TOUCH_ROW_SPACING) / IntToFloat(nRows) - NUI_TOUCH_ROW_SPACING;
    if (fFit >= fRow)
        return jList;
    return JsonObjectSet(jList, "row_height", JsonFloat(fFit > 1.0 ? fFit : 1.0));
}

json NuiTouch_NarrowLists(json jLayout, float fSide)
{
    if (fSide <= 0.0 || JsonGetType(jLayout) != JSON_TYPE_OBJECT)
        return jLayout;
    json jRoot = JsonObjectGet(jLayout, "root");
    if (JsonGetType(jRoot) == JSON_TYPE_OBJECT)
        return JsonObjectSet(jLayout, "root", NuiTouch_NarrowLists(jRoot, fSide));
    string sType = JsonGetString(JsonObjectGet(jLayout, "type"));
    float fW = _NuiTouch_Fixed(jLayout, TRUE);
    int bBorder = _NuiTouch_Border(jLayout);
    if (sType == "list")
    {
        // What its cells lack once its inset is fSide wider (all of it when its width is not set).
        float fCells = _NuiTouch_SumWidths(JsonObjectGet(jLayout, "row_template"));
        float fIn = bBorder ? NUI_TOUCH_LIST_IN : 0.0;
        float fCut = 2.0 * fSide;
        if (fW >= 0.0)
        {
            fCut = fCells - _NuiTouch_ListRoom(fW, _NuiTouch_Scrollbars(jLayout, NUI_SCROLLBARS_Y), fIn + fSide);
            if (fCut < 0.0)
                fCut = 0.0;
        }
        return NuiTouch_FitRows(_NuiTouch_NarrowCells(jLayout, fCut), fSide);
    }
    json jKids = JsonObjectGet(jLayout, "children");
    if (JsonGetType(jKids) != JSON_TYPE_ARRAY)
        return jLayout;
    int i;
    if (sType == "group" && bBorder && JsonGetLength(jKids) > 0)
    {
        // A bordered group's content, as a list's cells (one: its own width or the group's inside).
        json jKid = JsonArrayGet(jKids, 0);
        float fKid = _NuiTouch_Fixed(jKid, TRUE);
        int nScroll = _NuiTouch_Scrollbars(jLayout, NUI_SCROLLBARS_AUTO);
        float fCut = 2.0 * fSide;
        if (fW >= 0.0 && fKid >= 0.0)
        {
            int bBar = nScroll == NUI_SCROLLBARS_Y || nScroll == NUI_SCROLLBARS_BOTH;
            fCut = fKid + _NuiTouch_Margins(jKid) - (fW - 2.0 * (NUI_TOUCH_LIST_IN + fSide) - (bBar ? NUI_TOUCH_SCROLLBAR_W : 0.0));
            if (fCut < 0.0)
                fCut = 0.0;
        }
        jKids = JsonArraySet(jKids, 0, NuiTouch_Narrow(jKid, fCut));
    }
    for (i = 0; i < JsonGetLength(jKids); i++)
        jKids = JsonArraySet(jKids, i, NuiTouch_NarrowLists(JsonArrayGet(jKids, i), fSide));
    return JsonObjectSet(jLayout, "children", jKids);
}

// ---------------------------------------------------------------------------------------------------------------
// A window for a player
// ---------------------------------------------------------------------------------------------------------------

json NuiTouch_Layout(object oPC, json jElem)
{
    float fD = NuiTouch_Density(oPC);
    SetLocalFloat(oPC, NUI_TOUCH_VAR_GROWN, 0.0);
    if (fD == 1.0)
        return jElem;
    // Taller controls first, then the narrower cells, both in designed units; then the division.
    jElem = NuiTouch_GrowControls(jElem, NuiTouch_ControlGrowth(oPC));
    SetLocalFloat(oPC, NUI_TOUCH_VAR_GROWN, NuiTouch_LastGrowth());
    jElem = NuiTouch_NarrowLists(jElem, NuiTouch_ListInsetExtra(oPC));
    return _NuiTouch_Divide(jElem, fD);
}

float NuiTouch_Grown(object oPC)
{
    return NuiTouch_IsTouch(oPC) ? GetLocalFloat(oPC, NUI_TOUCH_VAR_GROWN) : 0.0;
}

json NuiTouch_Rect(object oPC, float fX, float fY, float fW, float fH, float fGrown = 0.0)
{
    if (!NuiTouch_IsTouch(oPC))
        return NuiRect(fX, fY, fW, fH);
    if (fX < 0.0 || fY < 0.0)
    {
        // -1 (centred), -2 and -3 (at the mouse) land off-screen on iOS: the top left instead (NUI-MOBILE-027).
        fX = NUI_TOUCH_CORNER;
        fY = NUI_TOUCH_CORNER;
    }
    else
    {
        // The position is in points: divided by d / s it lands where the desktop puts it (NUI-MOBILE-026).
        float fF = NuiTouch_Factor(oPC);
        fX = fX / fF;
        fY = fY / fF;
    }
    return NuiRect(fX, fY, fW + NuiTouch_FrameExtra(oPC, FALSE), fH + NuiTouch_FrameExtra(oPC, TRUE) + fGrown);
}

json NuiTouch_Window(object oPC, json jWindow)
{
    if (!NuiTouch_IsTouch(oPC))
    {
        SetLocalFloat(oPC, NUI_TOUCH_VAR_GROWN, 0.0);
        return jWindow;
    }
    jWindow = JsonObjectSet(jWindow, "root", NuiTouch_Layout(oPC, JsonObjectGet(jWindow, "root")));
    float fGrown = NuiTouch_Grown(oPC);
    json jGeo = JsonObjectGet(jWindow, "geometry");
    if (JsonGetType(jGeo) == JSON_TYPE_OBJECT && JsonGetType(JsonObjectGet(jGeo, "bind")) == JSON_TYPE_NULL)
    {
        jGeo = NuiTouch_Rect(oPC, JsonGetFloat(JsonObjectGet(jGeo, "x")), JsonGetFloat(JsonObjectGet(jGeo, "y")),
                             JsonGetFloat(JsonObjectGet(jGeo, "w")), JsonGetFloat(JsonObjectGet(jGeo, "h")), fGrown);
        jWindow = JsonObjectSet(jWindow, "geometry", jGeo);
    }
    // A static least and most size (0: none) grow as the size does.
    json jLimit = JsonObjectGet(jWindow, "size_constraint");
    if (JsonGetType(jLimit) == JSON_TYPE_OBJECT && JsonGetType(JsonObjectGet(jLimit, "bind")) == JSON_TYPE_NULL)
    {
        float fExtraW = NuiTouch_FrameExtra(oPC, FALSE);
        float fExtraH = NuiTouch_FrameExtra(oPC, TRUE) + fGrown;
        json jKeys = JsonParse("[\"x\",\"y\",\"w\",\"h\"]");
        int i;
        for (i = 0; i < 4; i++)
        {
            string sKey = JsonGetString(JsonArrayGet(jKeys, i));
            float fValue = JsonGetFloat(JsonObjectGet(jLimit, sKey));
            if (fValue > 0.0)
                jLimit = JsonObjectSet(jLimit, sKey, JsonFloat(fValue + (i % 2 == 0 ? fExtraW : fExtraH)));
        }
        jWindow = JsonObjectSet(jWindow, "size_constraint", jLimit);
    }
    return jWindow;
}
