# Tutorial screenshots

Drop tutorial screenshots in this folder. The in-app tutorial shows an "Under
Construction" box until the matching file exists here, then displays the image
automatically.

Expected files (PNG or JPEG, same name):

| File | Shows |
| --- | --- |
| `pilot-sheet.png` | A loaded mech sheet — stats, weapons, systems |
| `overkill.png` | An Overkill / crit dice result in the tray |
| `mission-control.png` | The GM Mission Control (Live Squad / Field Telemetry) |

To add more, edit the `TUTORIAL` data in `main.js` — each `uc: { path, name }`
step points at a file here.
