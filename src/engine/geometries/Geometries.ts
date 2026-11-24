import { Vector2, Vector3 } from '../math';
import { Float32BufferAttribute } from '../core/BufferAttribute';
import { BufferGeometry } from '../core/BufferGeometry';

export class BoxGeometry extends BufferGeometry {
  override type = 'BoxGeometry';
  parameters: {
    width: number;
    height: number;
    depth: number;
    widthSegments: number;
    heightSegments: number;
    depthSegments: number;
  };

  constructor(
    width = 1,
    height = 1,
    depth = 1,
    widthSegments = 1,
    heightSegments = 1,
    depthSegments = 1,
  ) {
    super();

    this.parameters = {
      width,
      height,
      depth,
      widthSegments,
      heightSegments,
      depthSegments,
    };

    const ws = Math.floor(widthSegments);
    const hs = Math.floor(heightSegments);
    const ds = Math.floor(depthSegments);

    const indices: number[] = [];
    const vertices: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];

    let numberOfVertices = 0;
    let groupStart = 0;

    const buildPlane = (
      u: 'x' | 'y' | 'z',
      v: 'x' | 'y' | 'z',
      w: 'x' | 'y' | 'z',
      udir: number,
      vdir: number,
      pw: number,
      ph: number,
      pd: number,
      gridX: number,
      gridY: number,
      materialIndex: number,
    ) => {
      const segmentWidth = pw / gridX;
      const segmentHeight = ph / gridY;
      const widthHalf = pw / 2;
      const heightHalf = ph / 2;
      const depthHalf = pd / 2;
      const gridX1 = gridX + 1;
      const gridY1 = gridY + 1;

      let vertexCounter = 0;
      let groupCount = 0;
      const vec = new Vector3();

      for (let iy = 0; iy < gridY1; iy++) {
        const y = iy * segmentHeight - heightHalf;
        for (let ix = 0; ix < gridX1; ix++) {
          const x = ix * segmentWidth - widthHalf;
          vec[u] = x * udir;
          vec[v] = y * vdir;
          vec[w] = depthHalf;
          vertices.push(vec.x, vec.y, vec.z);

          vec[u] = 0;
          vec[v] = 0;
          vec[w] = pd > 0 ? 1 : -1;
          normals.push(vec.x, vec.y, vec.z);

          uvs.push(ix / gridX, 1 - iy / gridY);
          vertexCounter++;
        }
      }

      for (let iy = 0; iy < gridY; iy++) {
        for (let ix = 0; ix < gridX; ix++) {
          const a = numberOfVertices + ix + gridX1 * iy;
          const b = numberOfVertices + ix + gridX1 * (iy + 1);
          const c = numberOfVertices + (ix + 1) + gridX1 * (iy + 1);
          const d = numberOfVertices + (ix + 1) + gridX1 * iy;
          indices.push(a, b, d, b, c, d);
          groupCount += 6;
        }
      }

      this.addGroup(groupStart, groupCount, materialIndex);
      groupStart += groupCount;
      numberOfVertices += vertexCounter;
    };

    buildPlane('z', 'y', 'x', -1, -1, depth, height, width, ds, hs, 0);
    buildPlane('z', 'y', 'x', 1, -1, depth, height, -width, ds, hs, 1);
    buildPlane('x', 'z', 'y', 1, 1, width, depth, height, ws, ds, 2);
    buildPlane('x', 'z', 'y', 1, -1, width, depth, -height, ws, ds, 3);
    buildPlane('x', 'y', 'z', 1, -1, width, height, depth, ws, hs, 4);
    buildPlane('x', 'y', 'z', -1, -1, width, height, -depth, ws, hs, 5);

    this.setIndex(indices);
    this.setAttribute('position', new Float32BufferAttribute(vertices, 3));
    this.setAttribute('normal', new Float32BufferAttribute(normals, 3));
    this.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  }
}

export class PlaneGeometry extends BufferGeometry {
  override type = 'PlaneGeometry';
  parameters: { width: number; height: number; widthSegments: number; heightSegments: number };

  constructor(width = 1, height = 1, widthSegments = 1, heightSegments = 1) {
    super();
    this.parameters = { width, height, widthSegments, heightSegments };

    const widthHalf = width / 2;
    const heightHalf = height / 2;
    const gridX = Math.floor(widthSegments);
    const gridY = Math.floor(heightSegments);
    const gridX1 = gridX + 1;
    const gridY1 = gridY + 1;
    const segmentWidth = width / gridX;
    const segmentHeight = height / gridY;

    const indices: number[] = [];
    const vertices: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];

    for (let iy = 0; iy < gridY1; iy++) {
      const y = iy * segmentHeight - heightHalf;
      for (let ix = 0; ix < gridX1; ix++) {
        const x = ix * segmentWidth - widthHalf;
        vertices.push(x, -y, 0);
        normals.push(0, 0, 1);
        uvs.push(ix / gridX, 1 - iy / gridY);
      }
    }

    for (let iy = 0; iy < gridY; iy++) {
      for (let ix = 0; ix < gridX; ix++) {
        const a = ix + gridX1 * iy;
        const b = ix + gridX1 * (iy + 1);
        const c = ix + 1 + gridX1 * (iy + 1);
        const d = ix + 1 + gridX1 * iy;
        indices.push(a, b, d, b, c, d);
      }
    }

    this.setIndex(indices);
    this.setAttribute('position', new Float32BufferAttribute(vertices, 3));
    this.setAttribute('normal', new Float32BufferAttribute(normals, 3));
    this.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  }
}

export class SphereGeometry extends BufferGeometry {
  override type = 'SphereGeometry';
  parameters: {
    radius: number;
    widthSegments: number;
    heightSegments: number;
    phiStart: number;
    phiLength: number;
    thetaStart: number;
    thetaLength: number;
  };

  constructor(
    radius = 1,
    widthSegments = 32,
    heightSegments = 16,
    phiStart = 0,
    phiLength = Math.PI * 2,
    thetaStart = 0,
    thetaLength = Math.PI,
  ) {
    super();
    this.parameters = {
      radius,
      widthSegments,
      heightSegments,
      phiStart,
      phiLength,
      thetaStart,
      thetaLength,
    };

    const ws = Math.max(3, Math.floor(widthSegments));
    const hs = Math.max(2, Math.floor(heightSegments));
    const thetaEnd = Math.min(thetaStart + thetaLength, Math.PI);

    let index = 0;
    const grid: number[][] = [];
    const vertex = new Vector3();
    const normal = new Vector3();

    const indices: number[] = [];
    const vertices: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];

    for (let iy = 0; iy <= hs; iy++) {
      const verticesRow: number[] = [];
      const v = iy / hs;
      let uOffset = 0;
      if (iy === 0 && thetaStart === 0) uOffset = 0.5 / ws;
      else if (iy === hs && thetaEnd === Math.PI) uOffset = -0.5 / ws;

      for (let ix = 0; ix <= ws; ix++) {
        const u = ix / ws;
        vertex.x = -radius * Math.cos(phiStart + u * phiLength) * Math.sin(thetaStart + v * thetaLength);
        vertex.y = radius * Math.cos(thetaStart + v * thetaLength);
        vertex.z = radius * Math.sin(phiStart + u * phiLength) * Math.sin(thetaStart + v * thetaLength);
        vertices.push(vertex.x, vertex.y, vertex.z);

        normal.copy(vertex).normalize();
        normals.push(normal.x, normal.y, normal.z);
        uvs.push(u + uOffset, 1 - v);
        verticesRow.push(index++);
      }
      grid.push(verticesRow);
    }

    for (let iy = 0; iy < hs; iy++) {
      for (let ix = 0; ix < ws; ix++) {
        const a = grid[iy][ix + 1];
        const b = grid[iy][ix];
        const c = grid[iy + 1][ix];
        const d = grid[iy + 1][ix + 1];
        if (iy !== 0 || thetaStart > 0) indices.push(a, b, d);
        if (iy !== hs - 1 || thetaEnd < Math.PI) indices.push(b, c, d);
      }
    }

    this.setIndex(indices);
    this.setAttribute('position', new Float32BufferAttribute(vertices, 3));
    this.setAttribute('normal', new Float32BufferAttribute(normals, 3));
    this.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  }
}

export class CylinderGeometry extends BufferGeometry {
  override type = 'CylinderGeometry';
  parameters: {
    radiusTop: number;
    radiusBottom: number;
    height: number;
    radialSegments: number;
    heightSegments: number;
    openEnded: boolean;
    thetaStart: number;
    thetaLength: number;
  };

  constructor(
    radiusTop = 1,
    radiusBottom = 1,
    height = 1,
    radialSegments = 32,
    heightSegments = 1,
    openEnded = false,
    thetaStart = 0,
    thetaLength = Math.PI * 2,
  ) {
    super();
    this.parameters = {
      radiusTop,
      radiusBottom,
      height,
      radialSegments,
      heightSegments,
      openEnded,
      thetaStart,
      thetaLength,
    };

    const rs = Math.floor(radialSegments);
    const hs = Math.floor(heightSegments);

    const indices: number[] = [];
    const vertices: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];

    let index = 0;
    const indexArray: number[][] = [];
    const halfHeight = height / 2;
    let groupStart = 0;

    // Torso
    const normal = new Vector3();
    const vertex = new Vector3();
    let groupCount = 0;
    const slope = (radiusBottom - radiusTop) / height;

    for (let y = 0; y <= hs; y++) {
      const indexRow: number[] = [];
      const v = y / hs;
      const radius = v * (radiusBottom - radiusTop) + radiusTop;
      for (let x = 0; x <= rs; x++) {
        const u = x / rs;
        const theta = u * thetaLength + thetaStart;
        const sinTheta = Math.sin(theta);
        const cosTheta = Math.cos(theta);

        vertex.x = radius * sinTheta;
        vertex.y = -v * height + halfHeight;
        vertex.z = radius * cosTheta;
        vertices.push(vertex.x, vertex.y, vertex.z);

        normal.set(sinTheta, slope, cosTheta).normalize();
        normals.push(normal.x, normal.y, normal.z);
        uvs.push(u, 1 - v);
        indexRow.push(index++);
      }
      indexArray.push(indexRow);
    }

    for (let x = 0; x < rs; x++) {
      for (let y = 0; y < hs; y++) {
        const a = indexArray[y][x];
        const b = indexArray[y + 1][x];
        const c = indexArray[y + 1][x + 1];
        const d = indexArray[y][x + 1];
        if (radiusTop > 0 || y !== 0) {
          indices.push(a, b, d);
          groupCount += 3;
        }
        if (radiusBottom > 0 || y !== hs - 1) {
          indices.push(b, c, d);
          groupCount += 3;
        }
      }
    }

    this.addGroup(groupStart, groupCount, 0);
    groupStart += groupCount;

    const generateCap = (top: boolean) => {
      const centerIndexStart = index;
      const uv = new Vector2();
      let capGroupCount = 0;
      const radius = top ? radiusTop : radiusBottom;
      const sign = top ? 1 : -1;

      for (let x = 1; x <= rs; x++) {
        vertices.push(0, halfHeight * sign, 0);
        normals.push(0, sign, 0);
        uvs.push(0.5, 0.5);
        index++;
      }
      const centerIndexEnd = index;

      for (let x = 0; x <= rs; x++) {
        const u = x / rs;
        const theta = u * thetaLength + thetaStart;
        const cosTheta = Math.cos(theta);
        const sinTheta = Math.sin(theta);

        vertex.x = radius * sinTheta;
        vertex.y = halfHeight * sign;
        vertex.z = radius * cosTheta;
        vertices.push(vertex.x, vertex.y, vertex.z);
        normals.push(0, sign, 0);
        uv.x = cosTheta * 0.5 + 0.5;
        uv.y = sinTheta * 0.5 * sign + 0.5;
        uvs.push(uv.x, uv.y);
        index++;
      }

      for (let x = 0; x < rs; x++) {
        const c = centerIndexStart + x;
        const i = centerIndexEnd + x;
        if (top) indices.push(i, i + 1, c);
        else indices.push(i + 1, i, c);
        capGroupCount += 3;
      }

      this.addGroup(groupStart, capGroupCount, top ? 1 : 2);
      groupStart += capGroupCount;
    };

    if (!openEnded) {
      if (radiusTop > 0) generateCap(true);
      if (radiusBottom > 0) generateCap(false);
    }

    this.setIndex(indices);
    this.setAttribute('position', new Float32BufferAttribute(vertices, 3));
    this.setAttribute('normal', new Float32BufferAttribute(normals, 3));
    this.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  }
}

export class ConeGeometry extends CylinderGeometry {
  override type = 'ConeGeometry';

  constructor(
    radius = 1,
    height = 1,
    radialSegments = 32,
    heightSegments = 1,
    openEnded = false,
    thetaStart = 0,
    thetaLength = Math.PI * 2,
  ) {
    super(0, radius, height, radialSegments, heightSegments, openEnded, thetaStart, thetaLength);
  }
}

export class RingGeometry extends BufferGeometry {
  override type = 'RingGeometry';

  constructor(
    innerRadius = 0.5,
    outerRadius = 1,
    thetaSegments = 32,
    phiSegments = 1,
    thetaStart = 0,
    thetaLength = Math.PI * 2,
  ) {
    super();

    const ts = Math.max(3, Math.floor(thetaSegments));
    const ps = Math.max(1, Math.floor(phiSegments));

    const indices: number[] = [];
    const vertices: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];

    let radius = innerRadius;
    const radiusStep = (outerRadius - innerRadius) / ps;
    const vertex = new Vector3();
    const uv = new Vector2();

    for (let j = 0; j <= ps; j++) {
      for (let i = 0; i <= ts; i++) {
        const segment = thetaStart + (i / ts) * thetaLength;
        vertex.x = radius * Math.cos(segment);
        vertex.y = radius * Math.sin(segment);
        vertices.push(vertex.x, vertex.y, vertex.z);
        normals.push(0, 0, 1);
        uv.x = (vertex.x / outerRadius + 1) / 2;
        uv.y = (vertex.y / outerRadius + 1) / 2;
        uvs.push(uv.x, uv.y);
      }
      radius += radiusStep;
    }

    for (let j = 0; j < ps; j++) {
      const thetaSegmentLevel = j * (ts + 1);
      for (let i = 0; i < ts; i++) {
        const segment = i + thetaSegmentLevel;
        const a = segment;
        const b = segment + ts + 1;
        const c = segment + ts + 2;
        const d = segment + 1;
        indices.push(a, b, d, b, c, d);
      }
    }

    this.setIndex(indices);
    this.setAttribute('position', new Float32BufferAttribute(vertices, 3));
    this.setAttribute('normal', new Float32BufferAttribute(normals, 3));
    this.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  }
}

export class TorusGeometry extends BufferGeometry {
  override type = 'TorusGeometry';

  constructor(
    radius = 1,
    tube = 0.4,
    radialSegments = 12,
    tubularSegments = 48,
    arc = Math.PI * 2,
  ) {
    super();

    const rs = Math.floor(radialSegments);
    const ts = Math.floor(tubularSegments);

    const indices: number[] = [];
    const vertices: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];

    const center = new Vector3();
    const vertex = new Vector3();
    const normal = new Vector3();

    for (let j = 0; j <= rs; j++) {
      for (let i = 0; i <= ts; i++) {
        const u = (i / ts) * arc;
        const v = (j / rs) * Math.PI * 2;

        vertex.x = (radius + tube * Math.cos(v)) * Math.cos(u);
        vertex.y = (radius + tube * Math.cos(v)) * Math.sin(u);
        vertex.z = tube * Math.sin(v);
        vertices.push(vertex.x, vertex.y, vertex.z);

        center.x = radius * Math.cos(u);
        center.y = radius * Math.sin(u);
        center.z = 0;
        normal.subVectors(vertex, center).normalize();
        normals.push(normal.x, normal.y, normal.z);

        uvs.push(i / ts, j / rs);
      }
    }

    for (let j = 1; j <= rs; j++) {
      for (let i = 1; i <= ts; i++) {
        const a = (ts + 1) * j + i - 1;
        const b = (ts + 1) * (j - 1) + i - 1;
        const c = (ts + 1) * (j - 1) + i;
        const d = (ts + 1) * j + i;
        indices.push(a, b, d, b, c, d);
      }
    }

    this.setIndex(indices);
    this.setAttribute('position', new Float32BufferAttribute(vertices, 3));
    this.setAttribute('normal', new Float32BufferAttribute(normals, 3));
    this.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  }
}

export class PolyhedronGeometry extends BufferGeometry {
  override type = 'PolyhedronGeometry';

  constructor(vertices: number[], indices: number[], radius = 1, detail = 0) {
    super();

    const vertexBuffer: number[] = [];
    const uvBuffer: number[] = [];

    const getVertexByIndex = (idx: number, out: Vector3) => {
      const stride = idx * 3;
      out.set(vertices[stride], vertices[stride + 1], vertices[stride + 2]);
    };

    const pushVertex = (v: Vector3) => {
      vertexBuffer.push(v.x, v.y, v.z);
    };

    const subdivideFace = (a: Vector3, b: Vector3, c: Vector3, d: number) => {
      const cols = d + 1;
      const v: Vector3[][] = [];
      for (let i = 0; i <= cols; i++) {
        v[i] = [];
        const aj = a.clone().lerp(c, i / cols);
        const bj = b.clone().lerp(c, i / cols);
        const rows = cols - i;
        for (let j = 0; j <= rows; j++) {
          if (j === 0 && i === cols) v[i][j] = aj;
          else v[i][j] = aj.clone().lerp(bj, j / rows);
        }
      }
      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < 2 * (cols - i) - 1; j++) {
          const k = Math.floor(j / 2);
          if (j % 2 === 0) {
            pushVertex(v[i][k + 1]);
            pushVertex(v[i + 1][k]);
            pushVertex(v[i][k]);
          } else {
            pushVertex(v[i][k + 1]);
            pushVertex(v[i + 1][k + 1]);
            pushVertex(v[i + 1][k]);
          }
        }
      }
    };

    const a = new Vector3();
    const b = new Vector3();
    const c = new Vector3();
    for (let i = 0; i < indices.length; i += 3) {
      getVertexByIndex(indices[i], a);
      getVertexByIndex(indices[i + 1], b);
      getVertexByIndex(indices[i + 2], c);
      subdivideFace(a, b, c, detail);
    }

    const tmp = new Vector3();
    for (let i = 0; i < vertexBuffer.length; i += 3) {
      tmp.set(vertexBuffer[i], vertexBuffer[i + 1], vertexBuffer[i + 2]).normalize();
      const u = Math.atan2(tmp.z, -tmp.x) / (2 * Math.PI) + 0.5;
      const v = Math.atan2(-tmp.y, Math.sqrt(tmp.x * tmp.x + tmp.z * tmp.z)) / Math.PI + 0.5;
      uvBuffer.push(u, 1 - v);
      tmp.multiplyScalar(radius);
      vertexBuffer[i] = tmp.x;
      vertexBuffer[i + 1] = tmp.y;
      vertexBuffer[i + 2] = tmp.z;
    }

    this.setAttribute('position', new Float32BufferAttribute(vertexBuffer, 3));
    this.setAttribute('normal', new Float32BufferAttribute(vertexBuffer.slice(), 3));
    this.setAttribute('uv', new Float32BufferAttribute(uvBuffer, 2));

    if (detail === 0) {
      this.computeVertexNormals();
    } else {
      this.normalizeNormals();
    }
  }
}

export class OctahedronGeometry extends PolyhedronGeometry {
  override type = 'OctahedronGeometry';

  constructor(radius = 1, detail = 0) {
    const vertices = [1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1];
    const indices = [
      0, 2, 4, 0, 4, 3, 0, 3, 5, 0, 5, 2, 1, 2, 5, 1, 5, 3, 1, 3, 4, 1, 4, 2,
    ];
    super(vertices, indices, radius, detail);
  }
}

export class DodecahedronGeometry extends PolyhedronGeometry {
  override type = 'DodecahedronGeometry';

  constructor(radius = 1, detail = 0) {
    const t = (1 + Math.sqrt(5)) / 2;
    const r = 1 / t;
    const vertices = [
      -1, -1, -1, -1, -1, 1, -1, 1, -1, -1, 1, 1, 1, -1, -1, 1, -1, 1, 1, 1, -1, 1, 1, 1,
      0, -r, -t, 0, -r, t, 0, r, -t, 0, r, t,
      -r, -t, 0, -r, t, 0, r, -t, 0, r, t, 0,
      -t, 0, -r, t, 0, -r, -t, 0, r, t, 0, r,
    ];
    const indices = [
      3, 11, 7, 3, 7, 15, 3, 15, 13, 7, 19, 17, 7, 17, 6, 7, 6, 15,
      17, 4, 8, 17, 8, 10, 17, 10, 6, 8, 0, 16, 8, 16, 2, 8, 2, 10,
      0, 12, 1, 0, 1, 18, 0, 18, 16, 6, 10, 2, 6, 2, 13, 6, 13, 15,
      2, 16, 18, 2, 18, 3, 2, 3, 13, 18, 1, 9, 18, 9, 11, 18, 11, 3,
      4, 14, 12, 4, 12, 0, 4, 0, 8, 11, 9, 5, 11, 5, 19, 11, 19, 7,
      19, 5, 14, 19, 14, 4, 19, 4, 17, 1, 12, 14, 1, 14, 5, 1, 5, 9,
    ];
    super(vertices, indices, radius, detail);
  }
}

export class EdgesGeometry extends BufferGeometry {
  override type = 'EdgesGeometry';

  constructor(geometry?: BufferGeometry | null, thresholdAngle = 1) {
    super();

    if (!geometry) return;

    const precisionPoints = 4;
    const precision = Math.pow(10, precisionPoints);
    const thresholdDot = Math.cos((Math.PI / 180) * thresholdAngle);

    const indexAttr = geometry.getIndex();
    const positionAttr = geometry.getAttribute('position');
    if (!positionAttr) return;

    const indexCount = indexAttr ? indexAttr.count : positionAttr.count;
    const edgeData: Record<
      string,
      { index0: number; index1: number; normal: Vector3 } | null
    > = {};
    const vertices: number[] = [];

    const _v0 = new Vector3();
    const _v1 = new Vector3();
    const _v2 = new Vector3();
    const _e1 = new Vector3();
    const _e2 = new Vector3();
    const _normal = new Vector3();

    const hashVertex = (v: Vector3) =>
      `${Math.round(v.x * precision)},${Math.round(v.y * precision)},${Math.round(v.z * precision)}`;

    const triVerts = [_v0, _v1, _v2];
    const indexArr = [0, 0, 0];

    for (let i = 0; i < indexCount; i += 3) {
      if (indexAttr) {
        indexArr[0] = indexAttr.getX(i);
        indexArr[1] = indexAttr.getX(i + 1);
        indexArr[2] = indexAttr.getX(i + 2);
      } else {
        indexArr[0] = i;
        indexArr[1] = i + 1;
        indexArr[2] = i + 2;
      }

      _v0.fromBufferAttribute(positionAttr, indexArr[0]);
      _v1.fromBufferAttribute(positionAttr, indexArr[1]);
      _v2.fromBufferAttribute(positionAttr, indexArr[2]);

      _e1.subVectors(_v1, _v0);
      _e2.subVectors(_v2, _v0);
      _normal.crossVectors(_e1, _e2);
      if (_normal.lengthSq() === 0) continue;
      _normal.normalize();

      const hashes = [hashVertex(_v0), hashVertex(_v1), hashVertex(_v2)];
      if (hashes[0] === hashes[1] || hashes[1] === hashes[2] || hashes[2] === hashes[0]) continue;

      for (let j = 0; j < 3; j++) {
        const jNext = (j + 1) % 3;
        const vecHash0 = hashes[j];
        const vecHash1 = hashes[jNext];
        const v0 = triVerts[j];
        const v1 = triVerts[jNext];

        const hash = `${vecHash0}_${vecHash1}`;
        const reverseHash = `${vecHash1}_${vecHash0}`;

        if (reverseHash in edgeData && edgeData[reverseHash]) {
          if (_normal.dot(edgeData[reverseHash]!.normal) <= thresholdDot) {
            vertices.push(v0.x, v0.y, v0.z, v1.x, v1.y, v1.z);
          }
          edgeData[reverseHash] = null;
        } else if (!(hash in edgeData)) {
          edgeData[hash] = {
            index0: indexArr[j],
            index1: indexArr[jNext],
            normal: _normal.clone(),
          };
        }
      }
    }

    for (const key in edgeData) {
      const entry = edgeData[key];
      if (entry) {
        _v0.fromBufferAttribute(positionAttr, entry.index0);
        _v1.fromBufferAttribute(positionAttr, entry.index1);
        vertices.push(_v0.x, _v0.y, _v0.z, _v1.x, _v1.y, _v1.z);
      }
    }

    this.setAttribute('position', new Float32BufferAttribute(vertices, 3));
  }
}
