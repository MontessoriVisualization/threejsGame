const padaxis = {
  0: "leftStickX",
  1: "leftStickY",
  2: "rightStickX",
  3: "rightStickY"
};
export const input = { x: 0, z: 0 }; // x: -1 left, +1 right | z: -1 up, +1 down
const sources = { key: new Set(), ui: new Set(), pad: new Set() };

const isHeld = (a) => Object.values(sources).some((s) => s.has(a));

function refresh() {
  input.x = isHeld('right') - isHeld('left');
  input.z = isHeld('down') - isHeld('up');
}
let start = null;
function pollGamepad() {
  const pad = navigator.getGamepads()[0];
       if (pad.axes[0]==1){
          console.log(pad.axes)
        }
  if (pad) {
    for (const [index, name] of Object.entries(padaxis)) {
    if(pad.axes[index] > 0.5){
      sources.pad.add(name);
      
    }
  }
  refresh();
  start = requestAnimationFrame(pollGamepad);
}


  start = requestAnimationFrame(pollGamepad);

}


window.addEventListener("gamepadconnected", (e) => {
  if (start === null) start = requestAnimationFrame(pollGamepad);

});
window.addEventListener("gamepaddisconnected", () => {
  cancelAnimationFrame(start);
  start = null;
});