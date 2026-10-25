# Breach Point

A tactical shooter in the style of Rainbow Six Siege, in one HTML file (`index.html`). It uses Three.js r128 from cdnjs and its post-processing examples from jsDelivr. It is separate from the DIY Check-In app: nothing in `public/` or `server.js` serves or links to it.

Play: open `siege/index.html` in a browser. On a computer use keyboard and mouse; on a phone or tablet, touch controls appear automatically (left thumb moves, right thumb aims, on-screen buttons for everything else; play in landscape).

## What's in it

- **Home screen:** Home / Play / Operators / Armory / Options, over a 3D rooftop scene with three operators.
- **Modes:**
  - **Bomb:** plant or disable the defuser.
  - **Secure Area:** hold the room for 10s.
  - **Elimination**
  - **Lone Wolf:** 1 v 5.
  - **Custom game:** pick the map, starting side, rounds to win and bot skill.
- **Three maps, each with its own layout, floors and look:**
  - **Townhouse:** brick, 2 floors and a roof.
  - **Harbour Office:** concrete, 2 floors and a roof, two stairwells.
  - **Mountain Lodge:** timber in the snow, 3 floors and a roof.
- **Vertical play:**
  - Stairs between floors and a ladder to every roof.
  - Floor and roof hatches that charges, the hammer or grenades blow open, so you can drop onto the site.
  - Wooden floors can be shot through.
  - Defenders can reinforce hatches.
- **5v5 with AI teammates.** Sides swap every round. Bots route across floors, climb ladders, breach walls and hatches, plant and disable defusers.
- **Armory:** 4 weapons, sights including a 2.5x scope, muzzles, grips, a laser and finishes, with a 3D preview.
- **Feedback:** kill banners, a death screen, the kill feed and a Tab scoreboard with per-match K/D.
- **Auto aim (Options → Aim):**
  - **Auto aim** (default) pulls your sights onto the nearest enemy you can see and puts a red bracket on them.
  - **Assist** only nudges when an enemy is near the crosshair while you aim or fire.
  - **Off**
- **Characters:** 19 family members from three photos (Eid, a birthday and a party), each dressed as in their photo: hijabs, glasses, abayas, dresses, a thobe, hoodies, a check shirt, trainers, boots, slippers and sliders. Everyone wears a slim chest rig and an armband in their side's colour (orange for attack, blue for defence).
  - **Operators → Family:** type each person's name and pick who you play as. Names show above heads, in the kill feed and on the scoreboard, and are saved on the device.
  - Each match, both squads are drawn at random from everyone else, so different people turn up every game.
  - The home screen shows you and five others, with the smaller ones in front.
- **Scenery:**
  - Windows, skirting, rugs, paintings and plants inside.
  - Grass, bushes, rocks in the snow, a fence, a road with street lamps.
  - Hills, mountains or a harbour with cranes and a skyline around each map.
  - A sky with moving clouds and a sun.
- **Graphics:** physically based materials, shadows, ambient occlusion, bloom and a filmic grade. Set Graphics to Medium in Options if it stutters.
