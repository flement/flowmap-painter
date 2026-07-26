import { state } from './state.js';
import { flowCanvas, imgCanvas, imgCtx } from './canvas.js';
import { renderComposite } from './rendering.js';
import { toast } from './ui.js';

export async function launchDemo() {
  const modal = document.getElementById('demoModal');
  modal.style.display = 'flex';
  const canvas = document.getElementById('demoCanvas');
  const closeBtn = document.getElementById('demoClose');
  const restartBtn = document.getElementById('demoRestart');

  try {
    const THREE = await import('three');

    const rect = canvas.parentElement.getBoundingClientRect();
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setSize(rect.width, rect.height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    renderComposite();
    const flowTexture = new THREE.CanvasTexture(document.getElementById('flowCanvas'));
    flowTexture.minFilter = THREE.LinearFilter;
    flowTexture.magFilter = THREE.LinearFilter;

    const hasRef = imgCanvas.width > 0 && imgCanvas.height > 0 && imgCtx.getImageData(0, 0, 1, 1).data[3] > 0;
    const loader = new THREE.TextureLoader();
    const refTexture = hasRef
      ? new THREE.CanvasTexture(imgCanvas)
      : await new Promise(r => loader.load('debug.jpeg', r));
    refTexture.minFilter = THREE.LinearFilter;
    refTexture.magFilter = THREE.LinearFilter;

    const waterTex = await new Promise((resolve, reject) => {
      loader.load('water-normal.png', resolve, undefined, reject);
    });
    waterTex.wrapS = waterTex.wrapT = THREE.RepeatWrapping;
    waterTex.minFilter = THREE.LinearFilter;

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uFlowMap: { value: flowTexture },
        uWaterMap: { value: waterTex },
        uRefMap: { value: refTexture },
        uHasRef: { value: 1.0 },
        uTime: { value: 0 },
        uFlowStrength: { value: 0.08 },
        uFlowSpeed: { value: 0.3 },
        uRefractStrength: { value: 0.015 },
        uSpecularPower: { value: 64.0 },
        uSpecularStrength: { value: 0.6 },
        uFresnelPower: { value: 3.0 },
        uColorDeep: { value: new THREE.Color(0x0a2e4a) },
        uColorShallow: { value: new THREE.Color(0x1a6fa0) },
        uColorHighlight: { value: new THREE.Color(0xc8e6f5) },
        uLightDir: { value: new THREE.Vector3(0.5, 0.8, 0.6).normalize() },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uFlowMap;
        uniform sampler2D uWaterMap;
        uniform sampler2D uRefMap;
        uniform float uHasRef;
        uniform float uTime;
        uniform float uFlowStrength;
        uniform float uFlowSpeed;
        uniform float uRefractStrength;
        uniform float uSpecularPower;
        uniform float uSpecularStrength;
        uniform float uFresnelPower;
        uniform vec3 uColorDeep;
        uniform vec3 uColorShallow;
        uniform vec3 uColorHighlight;
        uniform vec3 uLightDir;
        varying vec2 vUv;

        vec3 decodeNormal(vec4 tex) {
          vec3 n = tex.rgb * 2.0 - 1.0;
          n.z = sqrt(max(0.0, 1.0 - dot(n.xy, n.xy)));
          return normalize(n);
        }

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }

        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1,0)), f.x),
                     mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
        }

        void main() {
          vec2 uv = vUv;

          vec4 flowDir = texture2D(uFlowMap, uv);
          vec2 flow = (flowDir.rg - 0.5) * 2.0;
          float flowMag = length(flow);

          vec2 ambientDir = vec2(cos(uTime * 0.13), sin(uTime * 0.17));
          float ambientStrength = 0.12 + flowMag * 0.08;
          vec2 totalFlow = flow + ambientDir * ambientStrength;

          float phase0 = fract(uTime * uFlowSpeed);
          float phase1 = fract(uTime * uFlowSpeed + 0.5);
          float blend = abs(phase0 * 2.0 - 1.0);

          vec2 scroll0 = totalFlow * phase0 * uFlowStrength;
          vec2 scroll1 = totalFlow * phase1 * uFlowStrength;
          vec3 n0 = decodeNormal(texture2D(uWaterMap, uv - scroll0));
          vec3 n1 = decodeNormal(texture2D(uWaterMap, uv * 1.3 - scroll1));
          vec3 normal = normalize(mix(n0, n1, blend));

          vec3 viewDir = vec3(0.0, 0.0, 1.0);
          float fresnel = pow(1.0 - max(dot(viewDir, normal), 0.0), uFresnelPower);

          float ndotl = max(dot(normal, uLightDir), 0.0);
          vec3 halfVec = normalize(uLightDir + viewDir);
          float specular = pow(max(dot(normal, halfVec), 0.0), uSpecularPower) * uSpecularStrength;

          vec3 waterColor = mix(uColorDeep, uColorShallow, ndotl * 0.5 + fresnel * 0.3);

          if (uHasRef > 0.5) {
            vec2 refractUV = uv + normal.xy * uRefractStrength * (1.0 + flowMag * 2.0);
            vec3 bg = texture2D(uRefMap, refractUV).rgb;
            float bgDarken = 1.0 - flowMag * 0.3;
            // bg *= mix(1.0, bgDarken, flowMag);
            vec3 surface = mix(waterColor * 0.5, waterColor, fresnel);
            waterColor = mix(bg, surface, fresnel * 0.7 + 0.25);
          } else {
            float depth = noise(uv * 6.0 + uTime * 0.05);
            vec3 floorColor = mix(uColorDeep, uColorShallow, depth * 0.5 + 0.5);
            floorColor += vec3(0.03) * noise(uv * 20.0 - uTime * 0.1);
            waterColor = mix(floorColor, waterColor, fresnel * 0.4 + 0.25);
          }

          waterColor += uColorHighlight * specular;
          waterColor += vec3(0.04, 0.06, 0.08) * fresnel;

          gl_FragColor = vec4(waterColor, 1.0);
        }
      `,
    });

    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    scene.add(quad);

    let animId = null;
    let startTime = performance.now();

    function animate() {
      animId = requestAnimationFrame(animate);
      material.uniforms.uTime.value = (performance.now() - startTime) / 1000;
      renderer.render(scene, camera);
    }
    animate();

    function cleanup() {
      if (animId) cancelAnimationFrame(animId);
      renderer.dispose();
      material.dispose();
    }

    closeBtn.onclick = () => { modal.style.display = 'none'; cleanup(); };
    restartBtn.onclick = () => {
      cleanup();
      startTime = performance.now();
      material.uniforms.uTime.value = 0;
      animate();
    };
    modal.addEventListener('click', e => {
      if (e.target === modal) { modal.style.display = 'none'; cleanup(); }
    });
  } catch (err) {
    console.error('Demo failed:', err);
    modal.style.display = 'none';
    toast('Failed to load demo');
  }
}
