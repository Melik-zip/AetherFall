// src/math.js — Zero-GC 3D Math, Noise, and Spatial Utilities for AETHERFALL
(function (AF) {
  'use strict';

  const EPS = 1e-6;
  const DEG2RAD = Math.PI / 180;
  const RAD2DEG = 180 / Math.PI;
  const TAU = Math.PI * 2;

  function clamp(v, min, max) {
    return v < min ? min : v > max ? max : v;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function damp(a, b, lambda, dt) {
    return lerp(a, b, 1 - Math.exp(-lambda * dt));
  }

  function smoothstep(edge0, edge1, x) {
    const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  function wrapAngle(a) {
    while (a > Math.PI) a -= TAU;
    while (a < -Math.PI) a += TAU;
    return a;
  }

  function dampAngle(a, b, lambda, dt) {
    const diff = wrapAngle(b - a);
    return wrapAngle(a + diff * (1 - Math.exp(-lambda * dt)));
  }

  function randRange(min, max) {
    return min + Math.random() * (max - min);
  }

  // Deterministic fast 2D & 3D value noise for procedural terrain and shaders
  function hash2(x, y) {
    const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
    return h - Math.floor(h);
  }

  function noise2(x, y) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const a = hash2(ix, iy);
    const b = hash2(ix + 1, iy);
    const c = hash2(ix, iy + 1);
    const d = hash2(ix + 1, iy + 1);
    return lerp(lerp(a, b, ux), lerp(c, d, ux), uy);
  }

  function fbm2(x, y, octaves = 4) {
    let val = 0;
    let amp = 0.5;
    let freq = 1;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      val += amp * noise2(x * freq, y * freq);
      norm += amp;
      amp *= 0.5;
      freq *= 2.03;
    }
    return val / norm;
  }

  // Vector3 operations writing into out (or allocating new Float32Array(3))
  const Vec3 = {
    create(x = 0, y = 0, z = 0) {
      const out = new Float32Array(3);
      out[0] = x; out[1] = y; out[2] = z;
      return out;
    },
    set(out, x, y, z) {
      out[0] = x; out[1] = y; out[2] = z;
      return out;
    },
    copy(out, a) {
      out[0] = a[0]; out[1] = a[1]; out[2] = a[2];
      return out;
    },
    add(out, a, b) {
      out[0] = a[0] + b[0]; out[1] = a[1] + b[1]; out[2] = a[2] + b[2];
      return out;
    },
    sub(out, a, b) {
      out[0] = a[0] - b[0]; out[1] = a[1] - b[1]; out[2] = a[2] - b[2];
      return out;
    },
    scale(out, a, s) {
      out[0] = a[0] * s; out[1] = a[1] * s; out[2] = a[2] * s;
      return out;
    },
    addScaled(out, a, b, s) {
      out[0] = a[0] + b[0] * s;
      out[1] = a[1] + b[1] * s;
      out[2] = a[2] + b[2] * s;
      return out;
    },
    dot(a, b) {
      return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    },
    cross(out, a, b) {
      const ax = a[0], ay = a[1], az = a[2];
      const bx = b[0], by = b[1], bz = b[2];
      out[0] = ay * bz - az * by;
      out[1] = az * bx - ax * bz;
      out[2] = ax * by - ay * bx;
      return out;
    },
    lenSq(a) {
      return a[0] * a[0] + a[1] * a[1] + a[2] * a[2];
    },
    len(a) {
      return Math.hypot(a[0], a[1], a[2]);
    },
    distSq(a, b) {
      const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
      return dx * dx + dy * dy + dz * dz;
    },
    dist(a, b) {
      return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    },
    normalize(out, a) {
      const l = Math.hypot(a[0], a[1], a[2]);
      if (l > EPS) {
        const inv = 1 / l;
        out[0] = a[0] * inv; out[1] = a[1] * inv; out[2] = a[2] * inv;
      } else {
        out[0] = 0; out[1] = 1; out[2] = 0;
      }
      return out;
    },
    lerp(out, a, b, t) {
      out[0] = a[0] + (b[0] - a[0]) * t;
      out[1] = a[1] + (b[1] - a[1]) * t;
      out[2] = a[2] + (b[2] - a[2]) * t;
      return out;
    }
  };

  // Column-major 4x4 Matrix library (WebGL native)
  const Mat4 = {
    create() {
      const m = new Float32Array(16);
      m[0] = 1; m[5] = 1; m[10] = 1; m[15] = 1;
      return m;
    },
    identity(out) {
      out.fill(0);
      out[0] = 1; out[5] = 1; out[10] = 1; out[15] = 1;
      return out;
    },
    copy(out, a) {
      out.set(a);
      return out;
    },
    multiply(out, a, b) {
      const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
      const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
      const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
      const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];

      let b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3];
      out[0] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
      out[1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
      out[2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
      out[3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

      b0 = b[4]; b1 = b[5]; b2 = b[6]; b3 = b[7];
      out[4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
      out[5] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
      out[6] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
      out[7] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

      b0 = b[8]; b1 = b[9]; b2 = b[10]; b3 = b[11];
      out[8] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
      out[9] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
      out[10] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
      out[11] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

      b0 = b[12]; b1 = b[13]; b2 = b[14]; b3 = b[15];
      out[12] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
      out[13] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
      out[14] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
      out[15] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
      return out;
    },
    perspective(out, fovyRad, aspect, near, far) {
      const f = 1.0 / Math.tan(fovyRad * 0.5);
      const nf = 1 / (near - far);
      out.fill(0);
      out[0] = f / aspect;
      out[5] = f;
      out[10] = (far + near) * nf;
      out[11] = -1;
      out[14] = 2 * far * near * nf;
      return out;
    },
    ortho(out, left, right, bottom, top, near, far) {
      const lr = 1 / (left - right);
      const bt = 1 / (bottom - top);
      const nf = 1 / (near - far);
      out.fill(0);
      out[0] = -2 * lr;
      out[5] = -2 * bt;
      out[10] = 2 * nf;
      out[12] = (left + right) * lr;
      out[13] = (top + bottom) * bt;
      out[14] = (far + near) * nf;
      out[15] = 1;
      return out;
    },
    lookAt(out, eye, center, up) {
      let zx = eye[0] - center[0];
      let zy = eye[1] - center[1];
      let zz = eye[2] - center[2];
      let len = Math.hypot(zx, zy, zz);
      if (len < EPS) { zz = 1; } else { zx /= len; zy /= len; zz /= len; }

      let xx = up[1] * zz - up[2] * zy;
      let xy = up[2] * zx - up[0] * zz;
      let xz = up[0] * zy - up[1] * zx;
      len = Math.hypot(xx, xy, xz);
      if (len < EPS) {
        xx = 1; xy = 0; xz = 0;
      } else {
        xx /= len; xy /= len; xz /= len;
      }

      const yx = zy * xz - zz * xy;
      const yy = zz * xx - zx * xz;
      const yz = zx * xy - zy * xx;

      out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0;
      out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0;
      out[8] = xz; out[9] = yz; out[10] = zz; out[11] = 0;
      out[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
      out[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
      out[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
      out[15] = 1;
      return out;
    },
    // Compose column-major Translation + R = Ry(yaw) * Rx(pitch) * Rz(roll) + Non-uniform Scale
    composeYXZ(out, tx, ty, tz, yaw, pitch, roll, sx, sy, sz) {
      const cy = Math.cos(yaw), sy_ = Math.sin(yaw);
      const cp = Math.cos(pitch), sp = Math.sin(pitch);
      const cr = Math.cos(roll), sr = Math.sin(roll);

      // R = Ry * Rx * Rz (column-major)
      const c00 = cy * cr + sy_ * sp * sr;
      const c01 = cp * sr;
      const c02 = -sy_ * cr + cy * sp * sr;

      const c10 = -cy * sr + sy_ * sp * cr;
      const c11 = cp * cr;
      const c12 = sy_ * sr + cy * sp * cr;

      const c20 = sy_ * cp;
      const c21 = -sp;
      const c22 = cy * cp;

      out[0] = c00 * sx; out[1] = c01 * sx; out[2] = c02 * sx; out[3] = 0;
      out[4] = c10 * sy; out[5] = c11 * sy; out[6] = c12 * sy; out[7] = 0;
      out[8] = c20 * sz; out[9] = c21 * sz; out[10] = c22 * sz; out[11] = 0;
      out[12] = tx;      out[13] = ty;       out[14] = tz;       out[15] = 1;
      return out;
    },
    // Point matrix along forward vector (+Z or -Z aligned; here +Z forward) with roll
    aimMatrix(out, pos, fwd, sx, sy, sz, spin = 0) {
      let fx = fwd[0], fy = fwd[1], fz = fwd[2];
      let fl = Math.hypot(fx, fy, fz);
      if (fl < EPS) { fx = 0; fy = 0; fz = 1; } else { fx /= fl; fy /= fl; fz /= fl; }

      let ux = 0, uy = 1, uz = 0;
      if (Math.abs(fy) > 0.98) { ux = 0; uy = 0; uz = 1; }

      // right = normalize(cross(up, fwd))
      let rx = uy * fz - uz * fy;
      let ry = uz * fx - ux * fz;
      let rz = ux * fy - uy * fx;
      const rl = Math.hypot(rx, ry, rz) || 1;
      rx /= rl; ry /= rl; rz /= rl;

      // ortho up = cross(fwd, right)
      const oux = fy * rz - fz * ry;
      const ouy = fz * rx - fx * rz;
      const ouz = fx * ry - fy * rx;

      const c = Math.cos(spin), s = Math.sin(spin);
      const rxx = rx * c + oux * s, ryy = ry * c + ouy * s, rzz = rz * c + ouz * s;
      const uxx = oux * c - rx * s, uyy = ouy * c - ry * s, uzz = ouz * c - rz * s;

      out[0] = rxx * sx; out[1] = ryy * sx; out[2] = rzz * sx; out[3] = 0;
      out[4] = uxx * sy; out[5] = uyy * sy; out[6] = uzz * sy; out[7] = 0;
      out[8] = fx * sz;  out[9] = fy * sz;  out[10] = fz * sz; out[11] = 0;
      out[12] = pos[0];  out[13] = pos[1];  out[14] = pos[2];  out[15] = 1;
      return out;
    },
    invert(out, m) {
      const m00 = m[0], m01 = m[1], m02 = m[2], m03 = m[3];
      const m10 = m[4], m11 = m[5], m12 = m[6], m13 = m[7];
      const m20 = m[8], m21 = m[9], m22 = m[10], m23 = m[11];
      const m30 = m[12], m31 = m[13], m32 = m[14], m33 = m[15];

      const b00 = m00 * m11 - m01 * m10, b01 = m00 * m12 - m02 * m10;
      const b02 = m00 * m13 - m03 * m10, b03 = m01 * m12 - m02 * m11;
      const b04 = m01 * m13 - m03 * m11, b05 = m02 * m13 - m03 * m12;
      const b06 = m20 * m31 - m21 * m30, b07 = m20 * m32 - m22 * m30;
      const b08 = m20 * m33 - m23 * m30, b09 = m21 * m32 - m22 * m31;
      const b10 = m21 * m33 - m23 * m31, b11 = m22 * m33 - m23 * m32;

      let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
      if (Math.abs(det) < EPS) return null;
      det = 1 / det;

      out[0] = (m11 * b11 - m12 * b10 + m13 * b09) * det;
      out[1] = (m02 * b10 - m01 * b11 - m03 * b09) * det;
      out[2] = (m31 * b05 - m32 * b04 + m33 * b03) * det;
      out[3] = (m22 * b04 - m21 * b05 - m23 * b03) * det;
      out[4] = (m12 * b08 - m10 * b11 - m13 * b07) * det;
      out[5] = (m00 * b11 - m02 * b08 + m03 * b07) * det;
      out[6] = (m32 * b02 - m30 * b05 - m33 * b01) * det;
      out[7] = (m20 * b05 - m22 * b02 + m23 * b01) * det;
      out[8] = (m10 * b10 - m11 * b08 + m13 * b06) * det;
      out[9] = (m01 * b08 - m00 * b10 - m03 * b06) * det;
      out[10] = (m30 * b04 - m31 * b02 + m33 * b00) * det;
      out[11] = (m21 * b02 - m20 * b04 - m23 * b00) * det;
      out[12] = (m11 * b07 - m10 * b09 - m12 * b06) * det;
      out[13] = (m00 * b09 - m01 * b07 + m02 * b06) * det;
      out[14] = (m31 * b01 - m30 * b03 - m32 * b00) * det;
      out[15] = (m20 * b03 - m21 * b01 + m22 * b00) * det;
      return out;
    },
    projectToScreen(outVec3, worldPos, viewProj, width, height) {
      const x = worldPos[0], y = worldPos[1], z = worldPos[2];
      const cx = viewProj[0] * x + viewProj[4] * y + viewProj[8] * z + viewProj[12];
      const cy = viewProj[1] * x + viewProj[5] * y + viewProj[9] * z + viewProj[13];
      const cz = viewProj[2] * x + viewProj[6] * y + viewProj[10] * z + viewProj[14];
      const cw = viewProj[3] * x + viewProj[7] * y + viewProj[11] * z + viewProj[15];
      if (cw <= 0.01) {
        outVec3[2] = -1;
        return false;
      }
      const invW = 1 / cw;
      outVec3[0] = (cx * invW * 0.5 + 0.5) * width;
      outVec3[1] = (1 - (cy * invW * 0.5 + 0.5)) * height;
      outVec3[2] = cz * invW;
      return outVec3[2] >= -1 && outVec3[2] <= 1;
    }
  };

  // Distance from point p to segment ab squared
  function distPointSegmentSq(p, a, b) {
    const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
    const apx = p[0] - a[0], apy = p[1] - a[1], apz = p[2] - a[2];
    const abLenSq = abx * abx + aby * aby + abz * abz;
    if (abLenSq < EPS) return apx * apx + apy * apy + apz * apz;
    const t = clamp((apx * abx + apy * aby + apz * abz) / abLenSq, 0, 1);
    const dx = apx - abx * t, dy = apy - aby * t, dz = apz - abz * t;
    return dx * dx + dy * dy + dz * dz;
  }

  AF.Math = {
    EPS, DEG2RAD, RAD2DEG, TAU,
    clamp, lerp, damp, smoothstep, wrapAngle, dampAngle, randRange,
    hash2, noise2, fbm2,
    Vec3, Mat4, distPointSegmentSq
  };
})(window.AF = window.AF || {});
