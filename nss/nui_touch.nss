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
/// The iOS client multiplies some NUI quantities by its screen density; desktop and Android clients do not. The rules
/// and the measurements are in the nwn-nui-spec (https://github.com/plenarius/nwn-nui-spec, spec/mobile.md); the
/// rule ids are cited below. The numbers come from ONE iPhone (density 3, GUI scales 1.0 and 1.6) and ONE Android
/// tablet, on build 89.8193.37-17. Other devices and builds may differ.
///
/// How to use it:
///
///   1. When a player logs in (or changes the GUI scale), call NuiTouch_StartProbe(oPC). It opens a small invisible
///      window that the client clamps into the screen and reports back within about 3 s (NUI-MOBILE-010).
///   2. In the module's NUI event script (or the probe's own, sEventScript), call NuiTouch_HandleEvent() first; it
///      returns TRUE when the event was the probe's, and stores the result on the player.
///   3. Build windows through NuiTouch_Window(oPC, jWindow), and set a bound geometry with NuiTouch_Rect(...). On a
///      desktop or Android client, or before the probe has answered, both return what they are given.
///   4. Values your script binds to draw-list coordinates, row heights or cell widths: divide them by
///      NuiTouch_Factor(oPC) (or pass them through NuiTouch_DivGeom).
///
/// Give every element margin 0 and make gaps with spacers (NUI-MOBILE-021): margins are multiplied on iOS and this
/// file does not change them. nwn-nui-designer's "portable margins" export writes windows that way.

#include "nw_inc_nui"

// ---------------------------------------------------------------------------------------------------------------
// The numbers (nwn-nui-spec tables/mobile.yaml)
// ---------------------------------------------------------------------------------------------------------------

const string NUI_TOUCH_PROBE_ID = "nui_touch_probe";

// The probe window: x = y = 20000, 300 x 150 (NUI-MOBILE-010).
const float NUI_TOUCH_PROBE_XY = 20000.0;
const float NUI_TOUCH_PROBE_W = 300.0;
const float NUI_TOUCH_PROBE_H = 150.0;
// Seconds to wait for the probe's answer before giving up (it came within about 3 s).
const float NUI_TOUCH_PROBE_WAIT = 6.0;

// A client whose density differs from its GUI scale by more than this is a touch (point-based) client.
const float NUI_TOUCH_TOLERANCE = 0.25;

// Fixed spacer cells narrower than this are dropped on a touch client: iOS draws a cell at least about 11 px wide
// (NUI-MOBILE-024), which pushes the other cells.
const float NUI_TOUCH_THIN_CELL = 4.0;

// The iOS frame's extra width and height over the desktop's 16 x 49, K / s^2 units at density 3 (NUI-MOBILE-030, a
// fit through two GUI scales), plus slack that windows needed in use.
const float NUI_TOUCH_FRAME_KW = 32.0;
const float NUI_TOUCH_FRAME_KH = 66.0;
const float NUI_TOUCH_FRAME_SLACK = 6.0;

// NuiList's row height when the JSON has none.
const float NUI_TOUCH_ROW_HEIGHT = 25.0;

// Local variables on the player.
const string NUI_TOUCH_VAR_D = "NUI_TOUCH_D";
const string NUI_TOUCH_VAR_S = "NUI_TOUCH_S";
const string NUI_TOUCH_VAR_TOUCH = "NUI_TOUCH";
const string NUI_TOUCH_VAR_DONE = "NUI_TOUCH_DONE";

// ---------------------------------------------------------------------------------------------------------------
// Declarations
// ---------------------------------------------------------------------------------------------------------------

/// The player's GUI scale s: gui_scale / 100, a scale of 0 or none counting as 1 (Android reports 0, NUI-MOBILE-040).
float NuiTouch_Scale(object oPC);

/// Opens the density probe on oPC (NUI-MOBILE-010). sEventScript: the script that gets its events (empty: the
/// module's NUI event script); it must call NuiTouch_HandleEvent().
void NuiTouch_StartProbe(object oPC, string sEventScript = "");

/// In an NUI event script: when the event is the probe's report, works the density out, stores it on the player,
/// closes the probe and returns TRUE. Returns FALSE for every other event.
int NuiTouch_HandleEvent();

/// TRUE once the probe has answered for the player's current GUI scale.
int NuiTouch_Known(object oPC);

/// TRUE when the probe found a touch (point-based) client: |d - s| > 0.25.
int NuiTouch_IsTouch(object oPC);

/// f = d / s: what iOS multiplies margins, row heights, cell widths, draw coordinates and the window position by
/// (NUI-MOBILE-020). 1.0 on desktop and Android, and until the probe has answered.
float NuiTouch_Factor(object oPC);

/// A number, a rect or vector object ({x, y, w, h}), or an array of them, divided by fDiv. Binds are left alone.
json NuiTouch_DivGeom(json jValue, float fDiv);

/// An element and everything in it, for oPC: list row heights and template cell widths divided by the factor, thin
/// fixed spacer cells dropped, draw-list coordinates divided by the factor (NUI-MOBILE-022, -023, -024, -025, -060).
/// Unchanged on desktop-like clients.
json NuiTouch_Layout(object oPC, json jElem);

/// A window for oPC: its layout through NuiTouch_Layout, and a static geometry through NuiTouch_Rect. A bound
/// geometry is left alone: set its value with NuiTouch_Rect. Unchanged on desktop-like clients.
json NuiTouch_Window(object oPC, json jWindow);

/// The geometry for oPC: on a touch client the position is divided by the factor (NUI-MOBILE-026), a window at -1,
/// -2 or -3 is put at the top left instead (centring lands off-screen on iOS, NUI-MOBILE-027), and the size gets the
/// frame's extra (NUI-MOBILE-030) and slack. Unchanged on desktop-like clients.
json NuiTouch_Rect(object oPC, float fX, float fY, float fW, float fH);

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

void NuiTouch_EndProbe(object oPC)
{
    int nToken = NuiFindWindow(oPC, NUI_TOUCH_PROBE_ID);
    if (nToken != 0)
        NuiDestroy(oPC, nToken);
}

void NuiTouch_StartProbe(object oPC, string sEventScript = "")
{
    if (!GetIsPC(oPC))
        return;
    NuiTouch_EndProbe(oPC);
    DeleteLocalInt(oPC, NUI_TOUCH_VAR_DONE);
    json jWin = NuiWindow(NuiCol(JsonArray()), JsonBool(FALSE), NuiBind("geometry"), JsonBool(FALSE), JsonBool(FALSE),
                          JsonBool(FALSE), JsonBool(TRUE), JsonBool(FALSE), JsonBool(FALSE));
    int nToken = NuiCreate(oPC, jWin, NUI_TOUCH_PROBE_ID, sEventScript);
    if (nToken == 0)
        return;
    NuiSetBind(oPC, nToken, "geometry", NuiRect(NUI_TOUCH_PROBE_XY, NUI_TOUCH_PROBE_XY, NUI_TOUCH_PROBE_W, NUI_TOUCH_PROBE_H));
    NuiSetBindWatch(oPC, nToken, "geometry", TRUE);
    DelayCommand(NUI_TOUCH_PROBE_WAIT, NuiTouch_EndProbe(oPC));
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
    // Not clamped yet (the echo of our own value), or nonsense: wait for the next report.
    if (fX <= 0.0 || fX >= NUI_TOUCH_PROBE_XY - 1.0)
        return TRUE;
    float fS = NuiTouch_Scale(oPC);
    float fGuiW = IntToFloat(GetPlayerDeviceProperty(oPC, PLAYER_DEVICE_PROPERTY_GUI_WIDTH));
    // d = (gui_width - w * s) / x_reported (NUI-MOBILE-011).
    float fD = (fGuiW - NUI_TOUCH_PROBE_W * fS) / fX;
    if (fD <= 0.0)
        fD = fS;
    SetLocalFloat(oPC, NUI_TOUCH_VAR_D, fD);
    SetLocalFloat(oPC, NUI_TOUCH_VAR_S, fS);
    SetLocalInt(oPC, NUI_TOUCH_VAR_TOUCH, fabs(fD - fS) > NUI_TOUCH_TOLERANCE);
    SetLocalInt(oPC, NUI_TOUCH_VAR_DONE, TRUE);
    NuiDestroy(oPC, nToken);
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

float NuiTouch_Factor(object oPC)
{
    if (!NuiTouch_IsTouch(oPC))
        return 1.0;
    return GetLocalFloat(oPC, NUI_TOUCH_VAR_D) / GetLocalFloat(oPC, NUI_TOUCH_VAR_S);
}

// ---------------------------------------------------------------------------------------------------------------
// Scaling a window
// ---------------------------------------------------------------------------------------------------------------

int NuiTouch_IsNumber(json jValue)
{
    int nType = JsonGetType(jValue);
    return nType == JSON_TYPE_INTEGER || nType == JSON_TYPE_FLOAT;
}

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
            if (NuiTouch_IsNumber(jPart))
                jValue = JsonObjectSet(jValue, sKey, JsonFloat(JsonGetFloat(jPart) / fDiv));
        }
    }
    return jValue;
}

// A draw-list item with its coordinates and sizes divided (NUI-MOBILE-025): not the glyph size, the image region
// (texels) or the line thickness.
json NuiTouch_DrawItem(json jItem, float fDiv)
{
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
    return jItem;
}

json NuiTouch_LayoutBy(json jElem, float fDiv);

json NuiTouch_LayoutBy(json jElem, float fDiv)
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
            jKids = JsonArraySet(jKids, i, NuiTouch_LayoutBy(JsonArrayGet(jKids, i), fDiv));
        jElem = JsonObjectSet(jElem, "children", jKids);
    }
    if (JsonGetString(JsonObjectGet(jElem, "type")) == "list")
    {
        // Rows are row_height x f tall on iOS (NUI-MOBILE-022).
        json jRow = JsonObjectGet(jElem, "row_height");
        float fRow = NuiTouch_IsNumber(jRow) ? JsonGetFloat(jRow) : NUI_TOUCH_ROW_HEIGHT;
        jElem = JsonObjectSet(jElem, "row_height", JsonFloat(fRow / fDiv));
        // Cell widths are multiplied too (NUI-MOBILE-023); thin fixed spacer cells are dropped (NUI-MOBILE-024).
        json jTemplate = JsonObjectGet(jElem, "row_template");
        if (JsonGetType(jTemplate) == JSON_TYPE_ARRAY)
        {
            json jCells = JsonArray();
            n = JsonGetLength(jTemplate);
            for (i = 0; i < n; i++)
            {
                json jCell = JsonArrayGet(jTemplate, i);
                json jCellElem = JsonArrayGet(jCell, 0);
                float fWidth = JsonGetFloat(JsonArrayGet(jCell, 1));
                json jVariable = JsonArrayGet(jCell, 2);
                int bVariable = JsonGetType(jVariable) == JSON_TYPE_NULL ? TRUE : JsonGetInt(jVariable);
                if (!bVariable && fWidth < NUI_TOUCH_THIN_CELL && JsonGetString(JsonObjectGet(jCellElem, "type")) == "spacer")
                    continue;
                jCell = JsonArraySet(jCell, 0, NuiTouch_LayoutBy(jCellElem, fDiv));
                if (JsonGetLength(jCell) > 1)
                    jCell = JsonArraySet(jCell, 1, JsonFloat(fWidth / fDiv));
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
            jDraw = JsonArraySet(jDraw, i, NuiTouch_DrawItem(JsonArrayGet(jDraw, i), fDiv));
        jElem = JsonObjectSet(jElem, "draw_list", jDraw);
    }
    return jElem;
}

json NuiTouch_Layout(object oPC, json jElem)
{
    float fF = NuiTouch_Factor(oPC);
    if (fF <= 1.0)
        return jElem;
    return NuiTouch_LayoutBy(jElem, fF);
}

float NuiTouch_FrameExtra(object oPC, int bHeight)
{
    if (!NuiTouch_IsTouch(oPC))
        return 0.0;
    float fS = GetLocalFloat(oPC, NUI_TOUCH_VAR_S);
    float fD = GetLocalFloat(oPC, NUI_TOUCH_VAR_D);
    // Measured at density 3; scaled by (d - 1) / 2 at another density (an assumption: not measured).
    float fK = (bHeight ? NUI_TOUCH_FRAME_KH : NUI_TOUCH_FRAME_KW) * (fD - 1.0) / 2.0;
    if (fK < 0.0)
        fK = 0.0;
    return fK / (fS * fS) + NUI_TOUCH_FRAME_SLACK;
}

json NuiTouch_Rect(object oPC, float fX, float fY, float fW, float fH)
{
    float fF = NuiTouch_Factor(oPC);
    if (fF <= 1.0)
        return NuiRect(fX, fY, fW, fH);
    // -1 (centred), -2 and -3 (at the mouse) land off-screen on iOS: the top left instead (NUI-MOBILE-027).
    fX = fX < 0.0 ? 0.0 : fX / fF;
    fY = fY < 0.0 ? 0.0 : fY / fF;
    return NuiRect(fX, fY, fW + NuiTouch_FrameExtra(oPC, FALSE), fH + NuiTouch_FrameExtra(oPC, TRUE));
}

json NuiTouch_Window(object oPC, json jWindow)
{
    if (NuiTouch_Factor(oPC) <= 1.0)
        return jWindow;
    jWindow = JsonObjectSet(jWindow, "root", NuiTouch_Layout(oPC, JsonObjectGet(jWindow, "root")));
    json jGeo = JsonObjectGet(jWindow, "geometry");
    if (JsonGetType(jGeo) == JSON_TYPE_OBJECT && JsonGetType(JsonObjectGet(jGeo, "bind")) == JSON_TYPE_NULL)
    {
        jGeo = NuiTouch_Rect(oPC, JsonGetFloat(JsonObjectGet(jGeo, "x")), JsonGetFloat(JsonObjectGet(jGeo, "y")),
                             JsonGetFloat(JsonObjectGet(jGeo, "w")), JsonGetFloat(JsonObjectGet(jGeo, "h")));
        jWindow = JsonObjectSet(jWindow, "geometry", jGeo);
    }
    return jWindow;
}
