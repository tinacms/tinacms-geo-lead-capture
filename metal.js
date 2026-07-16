// Liquid-metal border. Wraps a target element and paints an animated metal
// ring around it with a small WebGL2 canvas; the element's own opaque
// background covers the centre, so only the padding ring shows metal.
//
// Shader technique + GLSL adapted from paper-design's open-source
// @paper-design/shaders (MIT): a domain-warped repeating stripe field with
// per-channel fract() phase offsets for the chromatic metal look. Self
// contained, no dependencies. A `fill` shape (u_shape < 0.5) makes the whole
// canvas metal so the CSS ring can reveal it anywhere.

const VERT = `#version 300 es
precision highp float;
layout(location=0) in vec2 a_position;
uniform vec2 u_resolution; uniform float u_scale, u_rotation, u_originX, u_originY, u_offsetX, u_offsetY;
out vec2 v_objectUV;
void main(){
  gl_Position = vec4(a_position, 0., 1.);
  vec2 uv = a_position * .5;
  vec2 boxOrigin = vec2(.5 - u_originX, u_originY - .5);
  float r = u_rotation * 3.14159265 / 180.;
  mat2 rot = mat2(cos(r), sin(r), -sin(r), cos(r));
  float box = min(u_resolution.x, u_resolution.y);
  vec2 objScale = u_resolution / box;
  v_objectUV = uv * objScale + boxOrigin * (objScale - 1.) + vec2(-u_offsetX, u_offsetY);
  v_objectUV /= u_scale;
  v_objectUV = rot * v_objectUV;
}`;

const FRAG = `#version 300 es
precision highp float;
uniform vec2 u_resolution; uniform float u_time;
uniform vec4 u_colorBack, u_colorTint;
uniform float u_softness, u_repetition, u_shiftRed, u_shiftBlue, u_distortion, u_contour, u_angle, u_shape;
in vec2 v_objectUV;
out vec4 fragColor;
#define PI 3.14159265358979
vec2 rotate(vec2 uv, float th){ return mat2(cos(th), sin(th), -sin(th), cos(th)) * uv; }
vec3 permute(vec3 x){ return mod(((x*34.)+1.)*x, 289.); }
float snoise(vec2 v){
  const vec4 C = vec4(.211324865405187,.366025403784439,-.577350269189626,.024390243902439);
  vec2 i = floor(v + dot(v, C.yy)); vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.,0.) : vec2(0.,1.);
  vec4 x12 = x0.xyxy + C.xxzz; x12.xy -= i1; i = mod(i, 289.);
  vec3 p = permute(permute(i.y + vec3(0., i1.y, 1.)) + i.x + vec3(0., i1.x, 1.));
  vec3 m = max(.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.); m = m*m; m = m*m;
  vec3 x = 2.*fract(p*C.www)-1.; vec3 h = abs(x)-.5; vec3 ox = floor(x+.5); vec3 a0 = x-ox;
  m *= 1.79284291400159 - .85373472095314*(a0*a0 + h*h);
  vec3 g; g.x = a0.x*x0.x + h.x*x0.y; g.yz = a0.yz*x12.xz + h.yz*x12.yw;
  return 130.*dot(m, g);
}
float band(float c1, float c2, float p, vec3 w, float blur, float bump, float tint){
  float ch = mix(c2, c1, smoothstep(0., 2.*blur, p));
  float b = w[0];                          ch = mix(ch, c2, smoothstep(b, b+2.*blur, p));
  b = w[0] + .4*(1.-bump)*w[1];            ch = mix(ch, c1, smoothstep(b, b+2.*blur, p));
  b = w[0] + .5*(1.-bump)*w[1];            ch = mix(ch, c2, smoothstep(b, b+2.*blur, p));
  b = w[0] + w[1];                          ch = mix(ch, c1, smoothstep(b, b+2.*blur, p));
  float gt = (p - w[0] - w[1]) / w[2];
  ch = mix(ch, mix(c1, c2, smoothstep(0.,1.,gt)), smoothstep(b, b+.5*blur, p));
  ch = mix(ch, 1. - min(1., (1.-ch)/max(tint,1e-4)), u_colorTint.a);
  return ch;
}
void main(){
  float t = .3 * (u_time + 2.8);
  vec2 uv = v_objectUV + .5; uv.y = 1. - uv.y;
  float cycleWidth = u_repetition; float edge = 0.;
  vec2 rUV = uv - .5;
  float a = (-u_angle + 70.) * PI/180.;
  rUV = vec2(rUV.x*cos(a) - rUV.y*sin(a), rUV.x*sin(a) + rUV.y*cos(a)) + .5;

  if (u_shape < 0.5) {           // fill (whole canvas is metal)
    edge = 0.;
  } else if (u_shape < 2.) {     // circle
    vec2 s = (uv - .5) * .67; edge = pow(clamp(3.*length(s), 0., 1.), 18.);
  } else if (u_shape < 3.) {     // daisy
    vec2 s = (uv - .5) * 1.68; float r = length(s)*2.; float th = atan(s.y, s.x) + .2;
    r *= 1. + .05*sin(3.*th + 2.*t); float f = abs(cos(th*3.));
    edge = smoothstep(f, f+.7, r); edge *= edge; uv *= .8; cycleWidth *= 1.6;
  } else {                        // diamond
    vec2 s = rotate(uv - .5, .25*PI) * 1.42 + .5;
    vec2 mask = min(s, 1.-s); vec2 pt = vec2(.15);
    float mx = pow(smoothstep(0., pt.x, mask.x), .25);
    float my = pow(smoothstep(0., pt.y, mask.y), .25);
    edge = clamp(1. - mx*my, 0., 1.);
  }
  edge = mix(smoothstep(.9 - 2.*fwidth(edge), .9, edge), edge, smoothstep(0., .4, u_contour));

  float opacity = 1. - smoothstep(.9 - 2.*fwidth(edge), .9, edge);
  if (u_shape < 2.) edge = 1.2*edge; else edge = 1.8*pow(edge, 1.5);

  float diagBLtoTR = rUV.x - rUV.y, diagTLtoBR = rUV.x + rUV.y;
  vec3 color1 = vec3(.98,.98,1.);
  vec3 color2 = vec3(.05,.05,.07);

  vec2 g = uv - .5;
  float dist = length(g + vec2(0., .2*diagBLtoTR));
  g = rotate(g, (.25 - .2*diagBLtoTR)*PI);
  float direction = g.x;
  float bump = 1. - pow(1.8*dist, 1.2);

  float s1 = .12/cycleWidth*(1. - .4*bump), s2 = .07/cycleWidth*(1. + .4*bump);
  float wide = 1. - s1 - s2;
  float noise = snoise(uv - t);
  edge += (1.-edge)*u_distortion*noise;

  direction += diagBLtoTR;
  direction -= 2.*noise*diagBLtoTR*(smoothstep(0.,1.,edge)*(1.-smoothstep(0.,1.,edge)));
  direction *= mix(1., 1.-edge, smoothstep(.5,1.,u_contour));
  direction -= 1.7*edge*smoothstep(.5,1.,u_contour);
  direction += .2*pow(u_contour,4.)*(1.-smoothstep(0.,1.,edge));
  direction *= .1 + (1.1-edge)*bump;
  direction *= .4 + .6*(1.-smoothstep(.5,1.,edge));
  direction += .18*(smoothstep(.1,.2,uv.y)*(1.-smoothstep(.2,.4,uv.y)));
  direction += .03*(smoothstep(.1,.2,1.-uv.y)*(1.-smoothstep(.2,.4,1.-uv.y)));
  direction *= cycleWidth; direction -= t;

  float disp = clamp(1.-bump, 0., 1.);
  float dR = disp + .03*bump*noise + 5.*(smoothstep(-.1,.2,uv.y)*(1.-smoothstep(.1,.5,uv.y)))*(smoothstep(.4,.6,bump)*(1.-smoothstep(.4,1.,bump))) - diagBLtoTR;
  float dB = disp*1.3 + (smoothstep(0.,.4,uv.y)*(1.-smoothstep(.1,.8,uv.y)))*(smoothstep(.4,.6,bump)*(1.-smoothstep(.4,.8,bump))) - .2*edge;
  dR *= u_shiftRed/20.; dB *= u_shiftBlue/20.;

  float blur = u_softness/15.;
  vec3 w = vec3(cycleWidth*s1, cycleWidth*s2, wide);
  w[1] -= .02*smoothstep(0.,1.,edge+bump);
  float sr = fract(direction + dR);
  float r = band(color1.r, color2.r, sr, w, blur + fwidth(sr), bump, u_colorTint.r);
  float sg = fract(direction);
  float gg = band(color1.g, color2.g, sg, w, blur + fwidth(sg), bump, u_colorTint.g);
  float sb = fract(direction - dB);
  float b = band(color1.b, color2.b, sb, w, blur + fwidth(sb), bump, u_colorTint.b);

  vec3 color = vec3(r, gg, b) * opacity;
  color += u_colorBack.rgb * u_colorBack.a * (1. - opacity);
  opacity += u_colorBack.a * (1. - opacity);
  color += 1./256. * (fract(sin(dot(.014*gl_FragCoord.xy, vec2(12.9898,78.233)))*43758.5453) - .5);
  fragColor = vec4(color, opacity);
}`;

const STATIC = {
  u_scale: 0.85, u_rotation: 0, u_originX: 0.5, u_originY: 0.5, u_offsetX: 0,
  u_offsetY: 0, u_softness: 0.15, u_repetition: 1, u_shiftRed: 0.4,
  u_shiftBlue: 0.4, u_distortion: 0.05, u_contour: 0.4, u_angle: 70, u_shape: 0,
};

const SPEED = 0.22;
const REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches;
const UNIFORMS = [
  'u_resolution', 'u_time', 'u_colorBack', 'u_colorTint',
  ...Object.keys(STATIC),
];

const live = [];
let rafId = 0;

const compile = (gl, type, src) => {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(s));
  }
  return s;
};

const initGL = (canvas) => {
  const gl = canvas.getContext('webgl2', {
    antialias: true,
    premultipliedAlpha: false,
    alpha: true,
  });
  if (!gl) {
    return null;
  }
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  gl.useProgram(prog);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const loc = {};
  for (const n of UNIFORMS) {
    loc[n] = gl.getUniformLocation(prog, n);
  }
  for (const [k, v] of Object.entries(STATIC)) {
    gl.uniform1f(loc[k], v);
  }
  gl.uniform4fv(loc.u_colorBack, [0.667, 0.667, 0.6745, 0]);
  gl.uniform4fv(loc.u_colorTint, [1, 1, 1, 1]);
  return { gl, prog, loc, vao };
};

const draw = (inst, now) => {
  const { canvas, gl, loc } = inst;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    gl.viewport(0, 0, w, h);
  }
  if (inst.sync) {
    // Mirror another instance's clock so both canvases (same size) render the
    // exact same metal pattern.
    inst.phase = inst.sync.phase;
  } else {
    if (inst.last === null) {
      inst.last = now;
    }
    const dt = Math.min(0.05, (now - inst.last) / 1000);
    inst.last = now;
    // Ease current speed toward its target -> smooth loading -> loaded slow-down.
    inst.speed += (inst.target - inst.speed) * Math.min(1, dt * 2.5);
    const rate = inst.speed * (1 + inst.pulse * Math.sin(now * 0.0075));
    inst.phase += dt * rate;
  }
  // On-screen feature size (bigger = looser, coarser metal).
  gl.uniform1f(loc.u_scale, inst.feature / Math.max(1, Math.min(w, h)));
  gl.uniform2f(loc.u_resolution, canvas.clientWidth, canvas.clientHeight);
  gl.uniform1f(loc.u_time, inst.phase);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
};

const loop = (now) => {
  for (let i = live.length - 1; i >= 0; i--) {
    const inst = live[i];
    if (inst.dead || !inst.canvas.isConnected) {
      inst.gl.getExtension('WEBGL_lose_context')?.loseContext();
      live.splice(i, 1);
      continue;
    }
    draw(inst, now);
  }
  rafId = live.length ? requestAnimationFrame(loop) : 0;
};

// Register a canvas as an animated metal surface. Returns a handle to retune it
// (used by the loader to speed up then slow down), or null if WebGL2 is absent.
// Pass `sync: <handle from another metal()>` to mirror that instance's clock —
// two same-sized canvases then render an identical pattern.
function register(canvas, { speed = SPEED, pulse = 0, feature = 240, sync = null } = {}) {
  const g = initGL(canvas);
  if (!g) {
    return null;
  }
  const cap = (s) => (REDUCE ? Math.min(s, 0.06) : s);
  const inst = {
    ...g,
    canvas,
    phase: 0,
    last: null,
    speed: cap(speed),
    target: cap(speed),
    pulse: REDUCE ? 0 : pulse,
    feature,
    sync: sync?._inst ?? null,
    dead: false,
  };
  live.push(inst);
  if (!rafId) {
    rafId = requestAnimationFrame(loop);
  }
  return {
    _inst: inst,
    setSpeed(s) {
      inst.target = cap(s);
    },
    setPulse(p) {
      inst.pulse = REDUCE ? 0 : p;
    },
    destroy() {
      inst.dead = true;
    },
  };
}

export const metal = (canvas, opts) => register(canvas, opts);

export function coatMetal(el, { thickness = 20, block = false, mode = 'ring' } = {}) {
  if (!el || el.parentElement?.classList.contains('metal-frame')) {
    return;
  }
  const fill = mode === 'fill';
  const cs = getComputedStyle(el);
  const frame = document.createElement('div');
  frame.className =
    'metal-frame' + (block ? ' block' : '') + (fill ? ' fill' : '');
  frame.style.setProperty('--mr', cs.borderTopLeftRadius || '12px');
  frame.style.setProperty('--mt', fill ? '0px' : `${thickness}px`);
  // Move the element's outer margin to the frame so the ring stays tight to it.
  for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
    frame.style[`margin${side}`] = cs[`margin${side}`];
    el.style[`margin${side}`] = '0';
  }
  if (fill) {
    // Metal becomes the element's whole background; content sits on top.
    el.style.background = 'transparent';
  } else if (cs.boxShadow !== 'none') {
    // Ring: move the shadow to the frame so it doesn't fall across the metal.
    frame.style.boxShadow = cs.boxShadow;
    el.style.boxShadow = 'none';
  }
  const canvas = document.createElement('canvas');
  el.replaceWith(frame);
  frame.append(canvas, el);
  if (!register(canvas, { speed: SPEED })) {
    frame.classList.add('metal-fallback'); // CSS provides a static gradient ring
  }
}
