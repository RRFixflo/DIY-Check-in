# Breach Point

A tactical shooter in the style of Rainbow Six Siege, in one HTML file (`index.html`). It uses Three.js r128 from cdnjs and its post-processing examples from jsDelivr. It is separate from the DIY Check-In app: nothing in `public/` or `server.js` serves or links to it.

Play: open `siege/index.html` in a desktop browser (keyboard and mouse).

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
- **Operators:** RAZE, FORGE and MAUL on attack; WARDEN, VIGIL and BASTION on defence.
- **Armory:** 4 weapons, sights including a 2.5x scope, muzzles, grips, a laser and finishes, with a 3D preview.
- **Feedback:** kill banners, a death screen, the kill feed and a Tab scoreboard with per-match K/D.
- **Graphics:** physically based materials, shadows, ambient occlusion, bloom and a filmic grade. Set Graphics to Medium in Options if it stutters.
