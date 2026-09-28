import GUI from 'lil-gui'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'

/**
 * Base
 */
// Debug
const gui = new GUI({
    width: 400
})

// Canvas
const canvas = document.querySelector('canvas.webgl')

// Scene
const scene = new THREE.Scene()

/**
 * Loaders
 */
// Loading screen
const loader = document.querySelector('.loader')
const loaderBar = loader.querySelector('.loader-bar-fill')
const loaderPercent = loader.querySelector('.loader-percent')

const loadingManager = new THREE.LoadingManager(
    // Loaded — wait a beat so the first frames render before fading out
    () =>
    {
        loaderBar.style.transform = 'scaleX(1)'
        loaderPercent.textContent = '100%'
        window.setTimeout(() =>
        {
            loader.classList.add('is-loaded')
            loader.addEventListener('transitionend', () => loader.remove(), { once: true })
        }, 400)
    },

    // Progress
    (url, itemsLoaded, itemsTotal) =>
    {
        const progress = itemsLoaded / itemsTotal
        loaderBar.style.transform = `scaleX(${progress})`
        loaderPercent.textContent = `${Math.round(progress * 100)}%`
    }
)

// Texture loader
const textureLoader = new THREE.TextureLoader(loadingManager)

// Draco loader
const dracoLoader = new DRACOLoader(loadingManager)
dracoLoader.setDecoderPath('draco/')

// GLTF loader
const gltfLoader = new GLTFLoader(loadingManager)
gltfLoader.setDRACOLoader(dracoLoader)

/**
 * Backdrop
 */
// Equirectangular panorama wrapped around the camera
const backdropTexture = textureLoader.load('backdrop.jpg')
backdropTexture.colorSpace = THREE.SRGBColorSpace
// The panorama is always magnified on screen, and skipping mipmaps avoids a seam line where the longitude wraps
backdropTexture.generateMipmaps = false
backdropTexture.minFilter = THREE.LinearFilter

const backdropMaterial = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms:
    {
        uTexture: { value: backdropTexture },
        uCenter: { value: 0.613 },
        uHorizon: { value: 0.679 },
        uScale: { value: 2.34 },
        uBrightness: { value: 0.38 },
        uBlur: { value: 0.003 },
        uBokeh: { value: 10 }
    },
    vertexShader: `
        varying vec3 vDirection;

        void main()
        {
            vDirection = position;

            // Ignore camera translation and push the dome to the far plane
            vec4 projectedPosition = projectionMatrix * mat4(mat3(viewMatrix)) * vec4(position, 1.0);
            gl_Position = projectedPosition.xyww;
        }
    `,
    fragmentShader: `
        #define PI 3.1415926535897932384626433832795

        uniform sampler2D uTexture;
        uniform float uCenter;
        uniform float uHorizon;
        uniform float uScale;
        uniform float uBrightness;
        uniform float uBlur;
        uniform float uBokeh;

        varying vec3 vDirection;

        #define BLUR_SAMPLES 48

        // Depth of field: the backdrop is far behind the focused island, so gather a disc of samples like an out of focus lens
        vec3 lensBlur(vec2 uv)
        {
            vec3 sum = vec3(0.0);
            float totalWeight = 0.0;
            for(int i = 0; i < BLUR_SAMPLES; i++)
            {
                // Golden angle spiral spreads the samples evenly over the disc
                float progress = (float(i) + 0.5) / float(BLUR_SAMPLES);
                float angle = float(i) * 2.39996323;
                // Equirectangular x covers twice the angle of y, so halve it to keep the disc round
                vec2 offset = vec2(cos(angle) * 0.5, sin(angle)) * sqrt(progress) * uBlur;
                vec2 sampleUv = vec2(fract(uv.x + offset.x), clamp(uv.y + offset.y, 0.0, 1.0));

                vec3 color = texture2D(uTexture, sampleUv).rgb;
                // Bright spots dominate, so the sun and sky glints bloom into soft discs
                float weight = 1.0 + pow(dot(color, vec3(0.299, 0.587, 0.114)), 4.0) * uBokeh;
                sum += color * weight;
                totalWeight += weight;
            }
            return sum / totalWeight;
        }

        void main()
        {
            vec3 direction = normalize(vDirection);

            // Longitude relative to the initial view direction (-Z), wrapped so the seam stays behind the camera
            float longitude = atan(direction.z, direction.x) + PI * 0.5;
            longitude = mod(longitude + PI, 2.0 * PI) - PI;
            float latitude = asin(clamp(direction.y, -1.0, 1.0));

            // Direction to equirectangular coordinates, scaled up so more of the panorama fits in view
            vec2 uv = vec2(
                uCenter + longitude / (2.0 * PI) * uScale,
                uHorizon + latitude / PI * uScale
            );
            uv.x = fract(uv.x);
            uv.y = clamp(uv.y, 0.0, 1.0);

            vec3 color = uBlur > 0.0 ? lensBlur(uv) : texture2D(uTexture, uv).rgb;
            gl_FragColor = vec4(color * uBrightness, 1.0);

            #include <tonemapping_fragment>
            #include <colorspace_fragment>
        }
    `
})

const backdrop = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), backdropMaterial)
backdrop.frustumCulled = false
backdrop.renderOrder = -1
scene.add(backdrop)

const backdropFolder = gui.addFolder('Backdrop')
backdropFolder.add(backdropMaterial.uniforms.uCenter, 'value').min(0).max(1).step(0.001).name('center')
backdropFolder.add(backdropMaterial.uniforms.uHorizon, 'value').min(0).max(1).step(0.001).name('horizon')
backdropFolder.add(backdropMaterial.uniforms.uScale, 'value').min(1).max(4).step(0.01).name('scale')
backdropFolder.add(backdropMaterial.uniforms.uBrightness, 'value').min(0).max(2).step(0.01).name('brightness')
backdropFolder.add(backdropMaterial.uniforms.uBlur, 'value').min(0).max(0.03).step(0.0005).name('depthOfField')
backdropFolder.add(backdropMaterial.uniforms.uBokeh, 'value').min(0).max(10).step(0.1).name('bokeh')

/**
 * Sunset grade (relights the neutral bake so it sits in the same evening light as the backdrop)
 */
// Where the sun sits in the panorama
const SUN_UV = new THREE.Vector2(0.659, 0.616)

// Inverse of the backdrop shader's mapping: panorama coordinates to a world direction
const getBackdropDirection = (uv, target) =>
{
    const { uCenter, uHorizon, uScale } = backdropMaterial.uniforms
    const longitude = (uv.x - uCenter.value) * Math.PI * 2 / uScale.value
    const latitude = (uv.y - uHorizon.value) * Math.PI / uScale.value
    const angle = longitude - Math.PI * 0.5
    return target.set(
        Math.cos(angle) * Math.cos(latitude),
        Math.sin(latitude),
        Math.sin(angle) * Math.cos(latitude)
    )
}

const gradeParameters = {
    sunColor: '#ffa36b',
    skyColor: '#8f7ad6',
    shadowColor: '#2a1d4a',
    hazeColor: '#b58fc4',
    // One stone for the whole cliff: the bake's side band and the underside mesh were colored separately
    rockColor: '#6a3a40',
    rockShadeColor: '#4a2a3c',
    // The painted sun sits on the horizon: lift the light a little so it still grazes the ground
    sunElevation: 22
}

const gradeUniforms = {
    uSunDirection: { value: new THREE.Vector3() },
    uSunColor: { value: new THREE.Color(gradeParameters.sunColor) },
    uSkyColor: { value: new THREE.Color(gradeParameters.skyColor) },
    uShadowColor: { value: new THREE.Color(gradeParameters.shadowColor) },
    uHazeColor: { value: new THREE.Color(gradeParameters.hazeColor) },
    uGradeSaturation: { value: 0.9 },
    uGradeTint: { value: 0.26 },
    uGradeRim: { value: 0.55 },
    uGradeHaze: { value: 0.07 },
    uGradeDepth: { value: 3 },
    uGradeDepthFade: { value: 0.3 },
    uGradeExposure: { value: 0.96 },
    uRockColor: { value: new THREE.Color(gradeParameters.rockColor) },
    uRockShadeColor: { value: new THREE.Color(gradeParameters.rockShadeColor) },
    uRockBlend: { value: 1 },
    // Bottom of the rock fading into the sky, as fractions of the cliff depth
    uGradeFadeStart: { value: 0.45 },
    uGradeFadeEnd: { value: 0.95 }
}

// Screen-space position of the painted sun, used by the final grade for its haze
const backdropSunDirection = new THREE.Vector3()

const updateSunDirection = () =>
{
    getBackdropDirection(SUN_UV, backdropSunDirection)

    const elevation = THREE.MathUtils.degToRad(gradeParameters.sunElevation)
    const horizontal = new THREE.Vector2(backdropSunDirection.x, backdropSunDirection.z).normalize()
    gradeUniforms.uSunDirection.value.set(
        horizontal.x * Math.cos(elevation),
        Math.sin(elevation),
        horizontal.y * Math.cos(elevation)
    )
}
updateSunDirection()

const gradeVertexPars = `
    varying vec3 vGradeNormal;
    varying vec3 vGradePosition;
`

const gradeVertex = `
    // World space normal and position, instance aware (MeshBasicMaterial doesn't compute them without an env map)
    vec3 gradeNormal = normal;
    vec4 gradePosition = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
        gradeNormal = mat3(instanceMatrix) * gradeNormal;
        gradePosition = instanceMatrix * gradePosition;
    #endif
    vGradeNormal = normalize(mat3(modelMatrix) * gradeNormal);
    vGradePosition = (modelMatrix * gradePosition).xyz;
`

const gradeFragmentPars = `
    uniform vec3 uSunDirection;
    uniform vec3 uSunColor;
    uniform vec3 uSkyColor;
    uniform vec3 uShadowColor;
    uniform vec3 uHazeColor;
    uniform float uGradeSaturation;
    uniform float uGradeTint;
    uniform float uGradeRim;
    uniform float uGradeHaze;
    uniform float uGradeDepth;
    uniform float uGradeDepthFade;
    uniform float uGradeExposure;
    uniform vec3 uRockColor;
    uniform vec3 uRockShadeColor;
    uniform float uRockBlend;
    uniform float uGradeFadeStart;
    uniform float uGradeFadeEnd;

    varying vec3 vGradeNormal;
    varying vec3 vGradePosition;

    const vec3 GRADE_LUMA = vec3(0.2126, 0.7152, 0.0722);

    // Hue of a color with its brightness taken out, so tinting doesn't darken
    vec3 gradeHue(vec3 color)
    {
        return color / max(dot(color, GRADE_LUMA), 0.001);
    }

    vec3 sceneGrade(vec3 color)
    {
        vec3 normal = normalize(vGradeNormal) * (gl_FrontFacing ? 1.0 : -1.0);
        vec3 viewDirection = normalize(vGradePosition - cameraPosition);

        #ifdef GRADE_ROCK
            // Rock faces (the sides below the grass lip) get one shared palette, shaded per facet
            float rock = (1.0 - smoothstep(-0.03, -0.005, vGradePosition.y)) * (1.0 - smoothstep(0.55, 0.8, normal.y));
            // Shade by which way the face turns around the island, ignoring its tilt, so the vertical cliff band
            // and the sloping underside below it read as the same stone
            vec3 flatNormal = normalize(vec3(normal.x, 0.0, normal.z) + vec3(0.0, 0.0, 0.001));
            float facet = 0.5 + 0.5 * dot(flatNormal, normalize(vec3(-0.5, 0.0, 0.85)));
            vec3 rockColor = mix(uRockShadeColor, uRockColor, smoothstep(0.0, 1.0, facet));
            color = mix(color, rockColor, rock * uRockBlend);

            // The rest of the grade sees the same flattened normal, so the light doesn't split the rock again
            normal = normalize(mix(normal, flatNormal, rock * uRockBlend));
        #endif

        // Tame the daylight saturation of the bake (the lime grass especially)
        float luma = dot(color, GRADE_LUMA);
        color = mix(vec3(luma), color, uGradeSaturation);

        // Low sun behind the island: faces turned to it warm up, the rest is filled by the violet sky
        float sun = dot(normal, uSunDirection);
        vec3 tint = mix(gradeHue(uSkyColor), gradeHue(uSunColor), smoothstep(-0.35, 0.75, sun));
        color *= mix(vec3(1.0), tint, uGradeTint);

        // Backlit silhouettes: edges catch a warm rim when looking towards the sun
        float fresnel = pow(clamp(1.0 - abs(dot(viewDirection, normal)), 0.0, 1.0), 2.5);
        float backlight = smoothstep(-0.1, 0.9, dot(viewDirection, uSunDirection));
        color += uSunColor * fresnel * backlight * smoothstep(-0.15, 0.45, sun) * uGradeRim * (0.35 + luma);

        // The cliff sinks into violet shade towards the sea of clouds
        float below = clamp(-vGradePosition.y / uGradeDepth, 0.0, 1.0);
        color = mix(color, uShadowColor, below * below * uGradeDepthFade);

        // Shared atmosphere: lift the blacks into the same haze as the sky
        color = mix(color, uHazeColor, uGradeHaze);

        return color * uGradeExposure;
    }

    // The tip of the rock dissolves into the sky below
    float sceneFade()
    {
        float below = -vGradePosition.y / uGradeDepth;
        return 1.0 - smoothstep(uGradeFadeStart, uGradeFadeEnd, below);
    }
`

// Plug the sunset light into a MeshBasicMaterial
const applySceneGrade = (material, { rock = false } = {}) =>
{
    if(rock)
        material.defines = { GRADE_ROCK: '' }

    // Needed for the fade at the bottom of the rock
    material.transparent = true

    material.onBeforeCompile = (shader) =>
    {
        Object.assign(shader.uniforms, gradeUniforms)

        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\n' + gradeVertexPars)
            .replace('#include <project_vertex>', '#include <project_vertex>\n' + gradeVertex)

        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', '#include <common>\n' + gradeFragmentPars)
            .replace('#include <opaque_fragment>', 'outgoingLight = sceneGrade(outgoingLight);\ndiffuseColor.a *= sceneFade();\n#include <opaque_fragment>')
    }
    return material
}

const gradeFolder = gui.addFolder('Sunset grade')
for(const key of ['sunColor', 'skyColor', 'shadowColor', 'hazeColor', 'rockColor', 'rockShadeColor'])
{
    const uniformName = 'u' + key[0].toUpperCase() + key.slice(1)
    gradeFolder
        .addColor(gradeParameters, key)
        .onChange(() => gradeUniforms[uniformName].value.set(gradeParameters[key]))
}
gradeFolder.add(gradeParameters, 'sunElevation').min(-10).max(60).step(0.1).onChange(updateSunDirection)
gradeFolder.add(gradeUniforms.uGradeSaturation, 'value').min(0).max(1.5).step(0.01).name('saturation')
gradeFolder.add(gradeUniforms.uGradeTint, 'value').min(0).max(1).step(0.01).name('lightTint')
gradeFolder.add(gradeUniforms.uGradeRim, 'value').min(0).max(3).step(0.01).name('rimLight')
gradeFolder.add(gradeUniforms.uGradeHaze, 'value').min(0).max(0.5).step(0.001).name('haze')
gradeFolder.add(gradeUniforms.uGradeDepthFade, 'value').min(0).max(1).step(0.01).name('cliffShade')
gradeFolder.add(gradeUniforms.uRockBlend, 'value').min(0).max(1).step(0.01).name('unifyRock')
gradeFolder.add(gradeUniforms.uGradeFadeStart, 'value').min(0).max(1).step(0.01).name('fadeStart')
gradeFolder.add(gradeUniforms.uGradeFadeEnd, 'value').min(0).max(1.2).step(0.01).name('fadeEnd')
gradeFolder.add(gradeUniforms.uGradeExposure, 'value').min(0.3).max(2).step(0.01).name('exposure')

/**
 * Model
 */
// Rocky underside of the floating island, shaded per facet with vertex colors instead of the bake
const undersidePromise = gltfLoader.loadAsync('japanese_portal_diorama/underside.glb').then((gltf) =>
{
    const material = applySceneGrade(new THREE.MeshBasicMaterial({ vertexColors: true }), { rock: true })
    gltf.scene.traverse((child) =>
    {
        if(child.isMesh)
        {
            child.material = material
            // Transparent for its fade, but drawn before the mist and water so they layer on top
            child.renderOrder = -1
        }
    })
    scene.add(gltf.scene)
    return gltf.scene
})

gltfLoader.load(
    'japanese_portal_diorama/japanese_portal_diorama.gltf',
    (gltf) =>
    {
        const model = gltf.scene

        // The bake comes in as an emissive texture on a black PBR material: show it unlit, through the sunset grade
        model.traverse((child) =>
        {
            if(!child.isMesh)
                return
            const baked = child.material
            child.material = applySceneGrade(new THREE.MeshBasicMaterial({
                map: baked.emissiveMap,
                side: baked.side
            }), { rock: true })
            child.renderOrder = -1
            baked.dispose()
        })

        scene.add(model)
        createPetals(model)
        addCloudOccluder(model)

        // Frame the island together with its underside
        undersidePromise.then((underside) => frameModel(new THREE.Box3().setFromObject(model).union(new THREE.Box3().setFromObject(underside))))
    }
)

const frameModel = (box) =>
{
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())

    // Aim at the center so the rooftops and the underside tip both stay in frame
    const target = center.clone()
    controls.target.copy(target)

    const maxSize = Math.max(size.x, size.y, size.z)
    const fitDistance = maxSize / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)))
    const distance = fitDistance * 1.35

    // Default orientation
    const azimuth = THREE.MathUtils.degToRad(5)
    const elevation = THREE.MathUtils.degToRad(20)
    camera.position.set(
        target.x + distance * Math.cos(elevation) * Math.sin(azimuth),
        target.y + distance * Math.sin(elevation),
        target.z + distance * Math.cos(elevation) * Math.cos(azimuth)
    )
    camera.near = Math.max(0.01, distance / 100)
    camera.far = distance * 20
    camera.updateProjectionMatrix()
    controls.update()

    // Lock the camera to this framing: fixed distance and height, horizontal orbit only
    const polarAngle = controls.getPolarAngle()
    controls.minPolarAngle = polarAngle
    controls.maxPolarAngle = polarAngle
    controls.minDistance = distance
    controls.maxDistance = distance

    // Limit the horizontal orbit: left towards the house/sun side, right towards the bridge side
    controls.minAzimuthAngle = THREE.MathUtils.degToRad(-36)
    controls.maxAzimuthAngle = THREE.MathUtils.degToRad(20)
}

/**
 * Lights (emissive surfaces)
 */
const lightParameters = {
    windowColor: '#ff9b3d',
    windowIntensity: 3,
    lanternColor: '#ffab45',
    lanternIntensity: 4
}

// Pushed slightly towards the camera so they win over the coplanar baked faces
const createLightMaterial = () => new THREE.MeshBasicMaterial({
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -4
})

const lightMaterials = {
    window: createLightMaterial(),
    lantern: createLightMaterial()
}

// Colors above 1 are what the bloom pass picks up
const updateLightMaterials = () =>
{
    for(const key in lightMaterials)
    {
        lightMaterials[key].color
            .set(lightParameters[key + 'Color'])
            .multiplyScalar(lightParameters[key + 'Intensity'])
    }
}
updateLightMaterials()

/**
 * Shared shader chunks
 */
const simplexNoise = `
    // Simplex 3D noise (Ashima Arts / Stefan Gustavson)
    vec4 permute(vec4 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
    vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

    float snoise(vec3 v)
    {
        const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
        const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

        vec3 i = floor(v + dot(v, C.yyy));
        vec3 x0 = v - i + dot(i, C.xxx);

        vec3 g = step(x0.yzx, x0.xyz);
        vec3 l = 1.0 - g;
        vec3 i1 = min(g.xyz, l.zxy);
        vec3 i2 = max(g.xyz, l.zxy);

        vec3 x1 = x0 - i1 + C.xxx;
        vec3 x2 = x0 - i2 + 2.0 * C.xxx;
        vec3 x3 = x0 - 1.0 + 3.0 * C.xxx;

        i = mod(i, 289.0);
        vec4 p = permute(permute(permute(
            i.z + vec4(0.0, i1.z, i2.z, 1.0))
            + i.y + vec4(0.0, i1.y, i2.y, 1.0))
            + i.x + vec4(0.0, i1.x, i2.x, 1.0));

        float n_ = 1.0 / 7.0;
        vec3 ns = n_ * D.wyz - D.xzx;

        vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

        vec4 x_ = floor(j * ns.z);
        vec4 y_ = floor(j - 7.0 * x_);

        vec4 x = x_ * ns.x + ns.yyyy;
        vec4 y = y_ * ns.x + ns.yyyy;
        vec4 h = 1.0 - abs(x) - abs(y);

        vec4 b0 = vec4(x.xy, y.xy);
        vec4 b1 = vec4(x.zw, y.zw);

        vec4 s0 = floor(b0) * 2.0 + 1.0;
        vec4 s1 = floor(b1) * 2.0 + 1.0;
        vec4 sh = -step(h, vec4(0.0));

        vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
        vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

        vec3 p0 = vec3(a0.xy, h.x);
        vec3 p1 = vec3(a0.zw, h.y);
        vec3 p2 = vec3(a1.xy, h.z);
        vec3 p3 = vec3(a1.zw, h.w);

        vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
        p0 *= norm.x;
        p1 *= norm.y;
        p2 *= norm.z;
        p3 *= norm.w;

        vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
        m = m * m;
        return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
    }
`

/**
 * Portal (liquid metallic jade swirl)
 */
const portalParameters = {
    deepColor: '#03261c',
    jadeColor: '#1f8a64',
    highlightColor: '#b8f5d8',
    coreColor: '#7dffc8',
    glowColor: '#2dff7a'
}

const portalMaterial = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -4,
    uniforms:
    {
        uTime: { value: 0 },
        uCenter: { value: new THREE.Vector2() },
        uRadius: { value: 1 },
        uDeepColor: { value: new THREE.Color(portalParameters.deepColor) },
        uJadeColor: { value: new THREE.Color(portalParameters.jadeColor) },
        uHighlightColor: { value: new THREE.Color(portalParameters.highlightColor) },
        uCoreColor: { value: new THREE.Color(portalParameters.coreColor) },
        uGlowColor: { value: new THREE.Color(portalParameters.glowColor) },
        uSpeed: { value: 0.35 },
        uTwist: { value: 2.2 },
        uArms: { value: 3 },
        uTurbulence: { value: 0.9 },
        uBump: { value: 0.6 },
        uMetalness: { value: 0.85 },
        uIntensity: { value: 1.1 },
        uCoreIntensity: { value: 2.5 },
        uEmission: { value: 0.8 }
    },
    vertexShader: `
        uniform vec2 uCenter;
        uniform float uRadius;

        varying vec2 vUv;
        varying vec3 vWorldPosition;

        void main()
        {
            // The disc has no UVs: map its plane to [-1, 1] around the center
            vUv = (position.xy - uCenter) / uRadius;

            vec4 worldPosition = modelMatrix * vec4(position, 1.0);
            vWorldPosition = worldPosition.xyz;

            gl_Position = projectionMatrix * viewMatrix * worldPosition;
        }
    `,
    fragmentShader: `
        uniform float uTime;
        uniform vec3 uDeepColor;
        uniform vec3 uJadeColor;
        uniform vec3 uHighlightColor;
        uniform vec3 uCoreColor;
        uniform vec3 uGlowColor;
        uniform float uSpeed;
        uniform float uTwist;
        uniform float uArms;
        uniform float uTurbulence;
        uniform float uBump;
        uniform float uMetalness;
        uniform float uIntensity;
        uniform float uCoreIntensity;
        uniform float uEmission;

        varying vec2 vUv;
        varying vec3 vWorldPosition;

        ${simplexNoise}

        float fbm(vec3 p)
        {
            float value = 0.0;
            float amplitude = 0.5;
            for(int i = 0; i < 4; i++)
            {
                value += amplitude * snoise(p);
                p = p * 2.03 + vec3(1.7, -3.1, 0.9);
                amplitude *= 0.5;
            }
            return value;
        }

        // Liquid surface height: spiral arms twisted towards the center, bent by a domain warp
        float surfaceHeight(vec2 uv, vec2 warp, float time)
        {
            float radius = length(uv);
            float angle = atan(uv.y, uv.x);

            float twist = angle + uTwist * log(radius + 0.08) - time;
            float bands = sin(twist * uArms + (warp.x + warp.y) * 3.0 * uTurbulence);

            // Rotate the noise with the flow so it streaks along the spiral
            vec2 swirled = vec2(cos(twist), sin(twist)) * radius;
            float ripples = fbm(vec3(swirled * 1.3 + warp * uTurbulence * 0.6, time * 0.3));

            return bands * 0.7 + ripples * 0.3;
        }

        void main()
        {
            float time = uTime * uSpeed;
            vec2 uv = vUv;
            float radius = length(uv);

            // Slow warp shared by the height samples so the surface wobbles like a liquid
            vec2 warp = vec2(
                fbm(vec3(uv * 1.1, time * 0.2)),
                fbm(vec3(uv * 1.1 + 7.3, time * 0.2))
            );

            // Height and its gradient (finite differences) give the liquid's surface normal
            float e = 0.02;
            float h = surfaceHeight(uv, warp, time);
            float hx = surfaceHeight(uv + vec2(e, 0.0), warp, time);
            float hy = surfaceHeight(uv + vec2(0.0, e), warp, time);

            // Flatten towards the core so the center reads as a calm glowing eye
            float bumpFade = smoothstep(0.05, 0.35, radius) * uBump * 0.05;
            vec3 normal = normalize(vec3(-(hx - h) / e * bumpFade, -(hy - h) / e * bumpFade, 1.0));

            // The disc lies in the model's XY plane: flip to face whichever side is being looked at
            normal.z *= gl_FrontFacing ? 1.0 : -1.0;
            vec3 viewDirection = normalize(vWorldPosition - cameraPosition);
            vec3 reflection = reflect(viewDirection, normal);

            // Jade body: dark in the troughs, milky jade on the crests
            float crest = smoothstep(-0.35, 0.65, h);
            vec3 albedo = mix(uDeepColor, uJadeColor, crest);
            albedo = mix(albedo, uHighlightColor, smoothstep(0.75, 1.0, h) * 0.35);

            // Fake environment for the metallic reflection: bright above, deep below
            vec3 environment = mix(uDeepColor, uHighlightColor, smoothstep(-0.4, 0.9, reflection.y));
            float fresnel = pow(1.0 - max(dot(-viewDirection, normal), 0.0), 3.0);
            vec3 metallic = albedo * mix(vec3(1.0), environment * 1.6, uMetalness);

            // Sharp specular streaks running along the ridges
            vec3 lightDirection = normalize(vec3(0.3, 0.8, 0.5));
            float specular = pow(max(dot(reflection, lightDirection), 0.0), 40.0);
            float sheen = pow(max(dot(reflection, normalize(vec3(-0.5, -0.2, 0.8))), 0.0), 12.0);

            vec3 color = metallic;
            color += uHighlightColor * (specular * 1.6 + sheen * 0.35) * uMetalness;
            color += uHighlightColor * fresnel * 0.4;

            // Glowing core pulling everything inwards
            float core = exp(-radius * radius * 45.0);
            float halo = exp(-radius * radius * 5.0) * (0.5 + 0.5 * sin(time * 2.0));
            color += uCoreColor * (core * uCoreIntensity + halo * 0.25);

            // Green light pouring out of the portal, strongest towards the rim
            float emission = 0.1 + 0.9 * smoothstep(0.6, 1.0, radius);
            color += uGlowColor * emission * uEmission * (0.3 + 0.7 * crest);

            gl_FragColor = vec4(color * uIntensity, 1.0);

            #include <tonemapping_fragment>
            #include <colorspace_fragment>
        }
    `
})

// Soft additive halo in front of the portal so its green light spills over the stone frame
const portalGlowMaterial = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms:
    {
        uGlowColor: portalMaterial.uniforms.uGlowColor,
        uStrength: { value: 1.2 },
        uSpread: { value: 2.5 },
        uFlash: { value: 0 }
    },
    vertexShader: `
        varying vec2 vUv;

        void main()
        {
            vUv = uv * 2.0 - 1.0;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        #define HALO_SIZE 2.4

        uniform vec3 uGlowColor;
        uniform float uStrength;
        uniform float uSpread;
        uniform float uFlash;

        varying vec2 vUv;

        void main()
        {
            // Distance in portal radii: 1.0 is the edge of the liquid
            float radius = length(vUv) * HALO_SIZE;

            // Faint over the liquid, peaking at the rim and falling off outwards
            float glow = smoothstep(0.8, 1.0, radius) * exp(-max(radius - 1.0, 0.0) * uSpread);
            glow *= 1.0 - smoothstep(HALO_SIZE * 0.8, HALO_SIZE, radius);

            gl_FragColor = vec4(uGlowColor * glow * uStrength * (1.0 + uFlash), 1.0);

            #include <colorspace_fragment>
        }
    `
})

gltfLoader.load(
    'japanese_portal_diorama/emissions.glb',
    (gltf) =>
    {
        gltf.scene.traverse((child) =>
        {
            if(!child.isMesh)
                return

            if(child.name === 'windowLight')
                child.material = lightMaterials.window
            else if(child.name === 'lanternLight')
                child.material = lightMaterials.lantern
            else if(child.name === 'portalLight')
            {
                // Fit the shader's coordinates to the disc
                child.geometry.computeBoundingBox()
                const box = child.geometry.boundingBox
                box.getCenter(portalMaterial.uniforms.uCenter.value)
                portalMaterial.uniforms.uRadius.value = Math.max(box.max.x - box.min.x, box.max.y - box.min.y) * 0.5
                child.material = portalMaterial

                const glow = new THREE.Mesh(
                    new THREE.PlaneGeometry(1, 1),
                    portalGlowMaterial
                )
                const center = box.getCenter(new THREE.Vector3())
                const radius = portalMaterial.uniforms.uRadius.value
                glow.scale.setScalar(radius * 2 * 2.4)
                glow.position.copy(center)
                glow.position.z += radius * 0.08
                glow.renderOrder = 1
                child.parent.add(glow)

                createPortalEnergy(child.parent, center, radius)
            }
        })
        scene.add(gltf.scene)
    }
)

const lightsFolder = gui.addFolder('Lights')
for(const key of ['window', 'lantern'])
{
    lightsFolder.addColor(lightParameters, key + 'Color').onChange(updateLightMaterials)
    lightsFolder.add(lightParameters, key + 'Intensity').min(0).max(10).step(0.01).onChange(updateLightMaterials)
}

const portalFolder = gui.addFolder('Portal')
for(const key in portalParameters)
{
    const uniformName = 'u' + key[0].toUpperCase() + key.slice(1)
    portalFolder
        .addColor(portalParameters, key)
        .onChange(() => portalMaterial.uniforms[uniformName].value.set(portalParameters[key]))
}
portalFolder.add(portalMaterial.uniforms.uSpeed, 'value').min(0).max(2).step(0.01).name('speed')
portalFolder.add(portalMaterial.uniforms.uTwist, 'value').min(0).max(6).step(0.01).name('twist')
portalFolder.add(portalMaterial.uniforms.uArms, 'value').min(1).max(8).step(1).name('arms')
portalFolder.add(portalMaterial.uniforms.uTurbulence, 'value').min(0).max(3).step(0.01).name('turbulence')
portalFolder.add(portalMaterial.uniforms.uBump, 'value').min(0).max(3).step(0.01).name('bump')
portalFolder.add(portalMaterial.uniforms.uMetalness, 'value').min(0).max(1).step(0.01).name('metalness')
portalFolder.add(portalMaterial.uniforms.uIntensity, 'value').min(0).max(4).step(0.01).name('intensity')
portalFolder.add(portalMaterial.uniforms.uCoreIntensity, 'value').min(0).max(10).step(0.01).name('coreIntensity')
portalFolder.add(portalMaterial.uniforms.uEmission, 'value').min(0).max(4).step(0.01).name('emission')
portalFolder.add(portalGlowMaterial.uniforms.uStrength, 'value').min(0).max(4).step(0.01).name('haloStrength')
portalFolder.add(portalGlowMaterial.uniforms.uSpread, 'value').min(0.5).max(8).step(0.01).name('haloFalloff')

/**
 * Portal energy (sparks and lightning)
 */
const energyParameters = {
    sparkCount: 900,
    sparkSize: 0.07,
    sparkSpeed: 1,
    sparkIntensity: 3,
    arcRate: 10,
    arcIntensity: 5,
    arcWidth: 3,
    flash: 0.8
}

const SPARK_MAX_COUNT = 3000

// Everything below lives in the portal's space: centered on the disc, 1 unit = the disc radius, +Z facing out
const portalEnergy = new THREE.Group()

// Sparks: a vortex sucked into the core, plus embers spilling out and falling towards the steps
const sparkGeometry = new THREE.BufferGeometry()
const sparkRandoms = new Float32Array(SPARK_MAX_COUNT * 4)
for(let i = 0; i < sparkRandoms.length; i++)
    sparkRandoms[i] = Math.random()
sparkGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPARK_MAX_COUNT * 3), 3))
sparkGeometry.setAttribute('aRandom', new THREE.BufferAttribute(sparkRandoms, 4))
sparkGeometry.setDrawRange(0, energyParameters.sparkCount)

const sparkMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms:
    {
        uTime: { value: 0 },
        uSize: { value: energyParameters.sparkSize },
        uSpeed: { value: energyParameters.sparkSpeed },
        uIntensity: { value: energyParameters.sparkIntensity },
        uFlash: portalGlowMaterial.uniforms.uFlash,
        uViewportHeight: { value: 1 },
        uGlowColor: portalMaterial.uniforms.uGlowColor,
        uHighlightColor: portalMaterial.uniforms.uHighlightColor
    },
    vertexShader: `
        #define PI 3.1415926535897932384626433832795

        uniform float uTime;
        uniform float uSize;
        uniform float uSpeed;
        uniform float uViewportHeight;

        attribute vec4 aRandom;

        varying float vAlpha;
        varying float vMix;
        varying float vRotation;

        void main()
        {
            float time = uTime * uSpeed;
            vec3 position;
            float alpha;

            if(aRandom.w < 0.6)
            {
                // Vortex: spiral inwards, spinning faster as it closes in on the core
                float progress = fract(time * mix(0.15, 0.4, aRandom.x) + aRandom.y);
                float radius = mix(1.3, 0.04, pow(progress, 0.8));
                float angle = aRandom.z * PI * 2.0 - time * 0.6 - 1.2 / (radius + 0.15);
                position = vec3(cos(angle) * radius, sin(angle) * radius, (aRandom.x - 0.3) * 0.12 * radius);
                alpha = smoothstep(0.0, 0.15, progress) * (1.0 - smoothstep(0.85, 1.0, progress));
            }
            else
            {
                // Embers: burst out of the surface, drift away from the portal and fall
                float progress = fract(time * mix(0.12, 0.3, aRandom.x) + aRandom.y);
                float angle = aRandom.z * PI * 2.0;
                float startRadius = sqrt(fract(aRandom.x * 7.13));
                vec2 outwards = vec2(cos(angle), sin(angle));
                float travel = progress * mix(0.4, 1.4, fract(aRandom.y * 5.71));

                position = vec3(outwards * (startRadius * 0.95 + travel * 0.5), 0.05 + travel * 1.3);
                position.y -= progress * progress * 0.9;
                alpha = smoothstep(0.0, 0.08, progress) * (1.0 - smoothstep(0.6, 1.0, progress));
            }

            // Jitter like charged dust
            position += vec3(
                sin(uTime * 3.1 + aRandom.y * 40.0),
                cos(uTime * 2.7 + aRandom.z * 40.0),
                sin(uTime * 2.3 + aRandom.x * 40.0)
            ) * 0.015;

            vec4 viewPosition = viewMatrix * modelMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * viewPosition;

            // Size in portal radii, turned into pixels with perspective
            float scale = length(modelMatrix[0].xyz);
            float size = uSize * mix(0.4, 1.4, fract(aRandom.z * 3.7));
            gl_PointSize = size * scale * projectionMatrix[1][1] * uViewportHeight * 0.5 / -viewPosition.z;

            // Twinkle
            float twinkle = 0.55 + 0.45 * sin(uTime * mix(8.0, 25.0, aRandom.x) + aRandom.y * 60.0);

            vAlpha = alpha * twinkle;
            vMix = fract(aRandom.w * 13.7);
            vRotation = aRandom.y * PI * 2.0 + uTime * (aRandom.x - 0.5) * 4.0;
        }
    `,
    fragmentShader: `
        uniform float uIntensity;
        uniform float uFlash;
        uniform vec3 uGlowColor;
        uniform vec3 uHighlightColor;

        varying float vAlpha;
        varying float vMix;
        varying float vRotation;

        void main()
        {
            // Tumbling little square with a soft glow around it
            vec2 uv = gl_PointCoord - 0.5;
            float c = cos(vRotation);
            float s = sin(vRotation);
            uv = mat2(c, -s, s, c) * uv;

            float square = 1.0 - smoothstep(0.14, 0.2, max(abs(uv.x), abs(uv.y)));
            float glow = clamp(0.03 / length(uv) - 0.06, 0.0, 1.0);
            float strength = max(square, glow);
            if(strength < 0.001)
                discard;

            vec3 color = mix(uGlowColor, uHighlightColor, vMix);
            color *= strength * vAlpha * uIntensity * (1.0 + uFlash * 0.5);

            gl_FragColor = vec4(color, 1.0);

            #include <colorspace_fragment>
        }
    `
})

const sparks = new THREE.Points(sparkGeometry, sparkMaterial)
sparks.frustumCulled = false
sparks.renderOrder = 2
portalEnergy.add(sparks)

// Lightning: jagged bolts crawling along the rim and leaping out onto the stone frame
const ARC_COUNT = 8
// The liquid sits recessed in the frame: its front face is about this far out, in portal radii
const FRAME_DEPTH = 0.32
const ARC_MAX_SEGMENTS = 160
const arcs = []
const arcMaterials = []

const createArcMaterial = (linewidth) =>
{
    const material = new LineMaterial({
        linewidth,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        worldUnits: false
    })
    arcMaterials.push(material)
    return material
}

for(let i = 0; i < ARC_COUNT; i++)
{
    const geometry = new LineSegmentsGeometry()
    geometry.setPositions(new Float32Array(ARC_MAX_SEGMENTS * 6))

    // Wide colored glow underneath a thin white-hot core
    const glow = new LineSegments2(geometry, createArcMaterial(energyParameters.arcWidth * 2.5))
    const core = new LineSegments2(geometry, createArcMaterial(energyParameters.arcWidth))
    for(const line of [glow, core])
    {
        line.frustumCulled = false
        line.renderOrder = 3
        line.visible = false
        portalEnergy.add(line)
    }

    arcs.push({ geometry, glow, core, life: 0, duration: 0, nextJitter: 0, params: null })
}

const randomRange = (min, max) => min + Math.random() * (max - min)

// Midpoint displacement: split every segment and kick the middle sideways
const jag = (points, depth, roughness) =>
{
    for(let level = 0; level < depth; level++)
    {
        const next = [points[0]]
        for(let i = 0; i < points.length - 1; i++)
        {
            const a = points[i]
            const b = points[i + 1]
            const offset = a.distanceTo(b) * roughness
            const middle = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5)
            middle.x += (Math.random() - 0.5) * offset
            middle.y += (Math.random() - 0.5) * offset
            middle.z += (Math.random() - 0.5) * offset * 0.5
            next.push(middle, b)
        }
        points = next
    }
    return points
}

const polarPoint = (angle, radius, z) => new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, z)

const createArcParams = () =>
{
    const angle = Math.random() * Math.PI * 2
    const roll = Math.random()

    // Crawl along the rim
    if(roll < 0.45)
        return { type: 'rim', angle, span: randomRange(0.5, 1.6) * (Math.random() < 0.5 ? -1 : 1), radius: randomRange(0.9, 0.97), depth: randomRange(0.08, FRAME_DEPTH) }

    // Leap from the rim out onto the frame
    if(roll < 0.85)
        return { type: 'leap', angle, drift: randomRange(-0.35, 0.35), length: randomRange(0.15, 0.6) }

    // Crack from the core to the rim
    return { type: 'core', angle, drift: randomRange(-0.8, 0.8) }
}

const buildArc = (arc) =>
{
    const { params } = arc
    let path

    if(params.type === 'rim')
    {
        // Along the inside of the frame's tunnel, between the liquid and the stone lip
        const guide = []
        for(let i = 0; i <= 4; i++)
        {
            const t = i / 4
            guide.push(polarPoint(params.angle + params.span * t, params.radius, params.depth + Math.sin(t * Math.PI) * randomRange(-0.1, 0.1)))
        }
        path = jag(guide, 3, 0.6)
    }
    else if(params.type === 'leap')
    {
        // Climb the tunnel wall, jump the lip and lick across the frame's face
        const start = polarPoint(params.angle, 0.93, 0.03)
        const lip = polarPoint(params.angle + params.drift * 0.3, 1, FRAME_DEPTH + 0.04)
        const end = polarPoint(params.angle + params.drift, 1 + params.length, FRAME_DEPTH + randomRange(0.04, 0.2))
        path = jag([start, lip, end], 4, 0.55)
    }
    else
    {
        const start = polarPoint(params.angle, 0.05, 0.03)
        const end = polarPoint(params.angle + params.drift, 0.95, 0.04)
        path = jag([start, end], 5, 0.5)
    }

    const segments = []
    const addPath = (points) =>
    {
        for(let i = 0; i < points.length - 1; i++)
            segments.push(points[i], points[i + 1])
    }
    addPath(path)

    // Forks shooting off the main bolt
    const forkCount = Math.floor(randomRange(1, 4))
    for(let f = 0; f < forkCount; f++)
    {
        const origin = path[Math.floor(randomRange(0.2, 0.8) * path.length)]
        const direction = new THREE.Vector3(origin.x, origin.y, 0).normalize()
        direction.applyAxisAngle(new THREE.Vector3(0, 0, 1), randomRange(-1, 1))
        const end = origin.clone().addScaledVector(direction, randomRange(0.1, 0.35))
        end.z += randomRange(0, 0.1)
        addPath(jag([origin, end], 3, 0.6))
    }

    const count = Math.min(segments.length / 2, ARC_MAX_SEGMENTS)
    const buffer = arc.geometry.attributes.instanceStart.data
    for(let i = 0; i < count * 2; i++)
        segments[i].toArray(buffer.array, i * 3)
    buffer.needsUpdate = true
    arc.geometry.instanceCount = count
}

const strikeArc = () =>
{
    const arc = arcs.find((candidate) => candidate.life <= 0)
    if(!arc)
        return

    arc.params = createArcParams()
    arc.duration = randomRange(0.12, 0.45)
    arc.life = arc.duration
    arc.nextJitter = 0
    arc.glow.visible = true
    arc.core.visible = true

    portalGlowMaterial.uniforms.uFlash.value += energyParameters.flash * (arc.params.type === 'core' ? 0.4 : 1)
}

const arcGlowColor = new THREE.Color()
const arcCoreColor = new THREE.Color()
const white = new THREE.Color(1, 1, 1)

const updatePortalEnergy = (elapsedTime, deltaTime) =>
{
    sparkMaterial.uniforms.uTime.value = elapsedTime

    // Random strikes, a few per second
    if(Math.random() < energyParameters.arcRate * deltaTime)
        strikeArc()

    for(const arc of arcs)
    {
        if(arc.life <= 0)
            continue

        arc.life -= deltaTime
        if(arc.life <= 0)
        {
            arc.glow.visible = false
            arc.core.visible = false
            continue
        }

        // Re-roll the jagged shape so the bolt crackles instead of sitting still
        arc.nextJitter -= deltaTime
        if(arc.nextJitter <= 0)
        {
            buildArc(arc)
            arc.nextJitter = randomRange(0.03, 0.07)
        }

        const fade = Math.sqrt(arc.life / arc.duration) * randomRange(0.6, 1)
        const brightness = energyParameters.arcIntensity * fade
        arcGlowColor.copy(portalMaterial.uniforms.uGlowColor.value).multiplyScalar(brightness * 0.6)
        arcCoreColor.copy(portalMaterial.uniforms.uHighlightColor.value).lerp(white, 0.6).multiplyScalar(brightness)
        arc.glow.material.color.copy(arcGlowColor)
        arc.core.material.color.copy(arcCoreColor)
    }

    // Each strike flashes the halo, then it settles back
    portalGlowMaterial.uniforms.uFlash.value *= Math.exp(-deltaTime * 8)
}

const updateEnergyResolution = () =>
{
    sparkMaterial.uniforms.uViewportHeight.value = sizes.height * Math.min(window.devicePixelRatio, 2)
    for(const material of arcMaterials)
        material.resolution.set(sizes.width, sizes.height)
}

const createPortalEnergy = (parent, center, radius) =>
{
    portalEnergy.position.copy(center)
    portalEnergy.scale.setScalar(radius)
    parent.add(portalEnergy)
}

const energyFolder = gui.addFolder('Portal energy')
energyFolder.add(energyParameters, 'sparkCount').min(0).max(SPARK_MAX_COUNT).step(1).onChange((count) => sparkGeometry.setDrawRange(0, count))
energyFolder.add(sparkMaterial.uniforms.uSize, 'value').min(0.005).max(0.15).step(0.001).name('sparkSize')
energyFolder.add(sparkMaterial.uniforms.uSpeed, 'value').min(0).max(3).step(0.01).name('sparkSpeed')
energyFolder.add(sparkMaterial.uniforms.uIntensity, 'value').min(0).max(10).step(0.01).name('sparkIntensity')
energyFolder.add(energyParameters, 'arcRate').min(0).max(30).step(0.1).name('arcsPerSecond')
energyFolder.add(energyParameters, 'arcIntensity').min(0).max(15).step(0.01)
energyFolder.add(energyParameters, 'arcWidth').min(0.5).max(8).step(0.1).onChange((width) =>
{
    for(const arc of arcs)
    {
        arc.core.material.linewidth = width
        arc.glow.material.linewidth = width * 2.5
    }
})
energyFolder.add(energyParameters, 'flash').min(0).max(3).step(0.01)
energyFolder.add({ strike: strikeArc }, 'strike')

/**
 * Petals
 */
const petalParameters = {
    count: 400,
    size: 0.011,
    radius: 0.85,
    colorA: '#ffc2cc',
    colorB: '#ef8aa6'
}

// Sakura petal: rounded teardrop with a small notch at the tip, slightly cupped
const petalShape = new THREE.Shape()
petalShape.moveTo(0, -0.5)
petalShape.bezierCurveTo(0.45, -0.3, 0.5, 0.25, 0.12, 0.5)
petalShape.lineTo(0, 0.4)
petalShape.lineTo(-0.12, 0.5)
petalShape.bezierCurveTo(-0.5, 0.25, -0.45, -0.3, 0, -0.5)

const petalGeometry = new THREE.ShapeGeometry(petalShape, 8)
const petalPositions = petalGeometry.attributes.position
for(let i = 0; i < petalPositions.count; i++)
{
    const x = petalPositions.getX(i)
    petalPositions.setZ(i, x * x * 0.6)
}
petalGeometry.computeVertexNormals()

const petalMaterial = applySceneGrade(new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }))

let petals = null
let petalArea = null

const createPetals = (model) =>
{
    if(model)
    {
        const box = new THREE.Box3().setFromObject(model)
        const size = box.getSize(new THREE.Vector3())
        petalArea = {
            center: box.getCenter(new THREE.Vector3()),
            // The land is a disc filling the footprint of the model
            radius: Math.min(size.x, size.z) * 0.5,
            // The diorama's origin sits on the ground surface
            floor: model.position.y,
            top: box.max.y,
            scale: Math.max(size.x, size.y, size.z)
        }
    }
    if(!petalArea)
        return

    if(petals)
    {
        scene.remove(petals)
        petals.dispose()
    }

    petals = new THREE.InstancedMesh(petalGeometry, petalMaterial, petalParameters.count)

    const dummy = new THREE.Object3D()
    const colorA = new THREE.Color(petalParameters.colorA)
    const colorB = new THREE.Color(petalParameters.colorB)
    const color = new THREE.Color()
    const maxRadius = petalArea.radius * petalParameters.radius

    for(let i = 0; i < petalParameters.count; i++)
    {
        // Uniform spread over the land circle, from the ground up to the tree tops
        const angle = Math.random() * Math.PI * 2
        const radius = Math.sqrt(Math.random()) * maxRadius
        dummy.position.set(
            petalArea.center.x + Math.cos(angle) * radius,
            petalArea.floor + Math.random() * (petalArea.top - petalArea.floor),
            petalArea.center.z + Math.sin(angle) * radius
        )
        dummy.rotation.set(
            Math.random() * Math.PI * 2,
            Math.random() * Math.PI * 2,
            Math.random() * Math.PI * 2
        )
        dummy.scale.setScalar(petalArea.scale * petalParameters.size * (0.6 + Math.random() * 0.8))
        dummy.updateMatrix()
        petals.setMatrixAt(i, dummy.matrix)

        petals.setColorAt(i, color.lerpColors(colorA, colorB, Math.random()))
    }

    scene.add(petals)
}

const petalsFolder = gui.addFolder('Petals')
petalsFolder.add(petalParameters, 'count').min(0).max(1000).step(1).onFinishChange(() => createPetals())
petalsFolder.add(petalParameters, 'size').min(0.001).max(0.05).step(0.0005).onFinishChange(() => createPetals())
petalsFolder.add(petalParameters, 'radius').min(0.1).max(1).step(0.01).onFinishChange(() => createPetals())
petalsFolder.addColor(petalParameters, 'colorA').onFinishChange(() => createPetals())
petalsFolder.addColor(petalParameters, 'colorB').onFinishChange(() => createPetals())
petalsFolder.add({ regenerate: () => createPetals() }, 'regenerate')

/**
 * Water
 */
const waterParameters = {
    deepColor: '#10263a',
    patchColor: '#284f57',
    shallowColor: '#3b6663',
    foamColor: '#f2d8cc',
    skyColor: '#c47f9c'
}

// Rocks sticking out of the stream: xz center and waterline radius
const waterRocks = [
    new THREE.Vector3(1.25, 3.25, 0.42),
    new THREE.Vector3(2.55, 2.25, 0.38),
    new THREE.Vector3(2.05, 3.9, 0.28)
]

const waterMaterial = new THREE.ShaderMaterial({
    // Coplanar with the baked stream, so push it towards the camera
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -4,
    uniforms:
    {
        uTime: { value: 0 },
        uDeepColor: { value: new THREE.Color(waterParameters.deepColor) },
        uPatchColor: { value: new THREE.Color(waterParameters.patchColor) },
        uShallowColor: { value: new THREE.Color(waterParameters.shallowColor) },
        uFoamColor: { value: new THREE.Color(waterParameters.foamColor) },
        uSkyColor: { value: new THREE.Color(waterParameters.skyColor) },
        uPortalColor: portalMaterial.uniforms.uGlowColor,
        uPortalPosition: { value: new THREE.Vector3(0.3, 1.95, -2.78) },
        uRocks: { value: waterRocks },
        uFlowSpeed: { value: 0.12 },
        uNoiseScale: { value: 0.9 },
        uShoreWidth: { value: 0.35 },
        uFoam: { value: 0.35 },
        uRipples: { value: 0.25 },
        uReflection: { value: 0.5 },
        uSunDirection: gradeUniforms.uSunDirection,
        uSunColor: gradeUniforms.uSunColor,
        uSunReflection: { value: 0.35 },
        uPortalReflection: { value: 0.2 },
        uGlints: { value: 0.4 }
    },
    vertexShader: `
        varying vec3 vWorldPosition;
        varying float vShore;

        void main()
        {
            // UV.x holds the distance to the nearest bank, baked in Blender
            vShore = uv.x;

            vec4 worldPosition = modelMatrix * vec4(position, 1.0);
            vWorldPosition = worldPosition.xyz;

            gl_Position = projectionMatrix * viewMatrix * worldPosition;
        }
    `,
    fragmentShader: `
        uniform float uTime;
        uniform vec3 uDeepColor;
        uniform vec3 uPatchColor;
        uniform vec3 uShallowColor;
        uniform vec3 uFoamColor;
        uniform vec3 uSkyColor;
        uniform vec3 uPortalColor;
        uniform vec3 uPortalPosition;
        uniform vec3 uRocks[3];
        uniform float uFlowSpeed;
        uniform float uNoiseScale;
        uniform float uShoreWidth;
        uniform float uFoam;
        uniform float uRipples;
        uniform float uReflection;
        uniform vec3 uSunDirection;
        uniform vec3 uSunColor;
        uniform float uSunReflection;
        uniform float uPortalReflection;
        uniform float uGlints;

        varying vec3 vWorldPosition;
        varying float vShore;

        ${simplexNoise}

        // Mottled, painterly pattern drifting downstream (towards +z)
        float mottle(vec2 p, float time)
        {
            vec2 warp = vec2(
                snoise(vec3(p * 0.6, time * 0.4)),
                snoise(vec3(p * 0.6 + 5.2, time * 0.4))
            );
            float large = snoise(vec3((p - vec2(0.0, time * 0.6)) * uNoiseScale + warp * 0.5, time * 0.5));
            float small = snoise(vec3((p - vec2(0.0, time)) * uNoiseScale * 2.4 + warp, time * 0.8 + 3.0));
            return large * 0.65 + small * 0.35;
        }

        void main()
        {
            float time = uTime * uFlowSpeed;
            vec2 p = vWorldPosition.xz;

            // Body: deep teal with soft lighter-green patches
            float pattern = mottle(p, time);
            vec3 color = mix(uDeepColor, uPatchColor, smoothstep(0.0, 0.6, pattern) * 0.85);
            color = mix(color, uDeepColor * 0.6, smoothstep(-0.2, -0.65, pattern) * 0.5);

            // Shallows brighten along the banks
            float shore = 1.0 - smoothstep(0.0, uShoreWidth, vShore + pattern * 0.06);
            color = mix(color, uShallowColor, shore * shore * 0.75);

            // Thin wobbly foam line hugging the banks
            float wobble = snoise(vec3(p * 6.0, uTime * 0.3)) * 0.02;
            float foam = 1.0 - smoothstep(0.015, 0.045, vShore + wobble);

            // Rocks: a foam collar at the waterline and rings rippling outwards
            float ripples = 0.0;
            for(int i = 0; i < 3; i++)
            {
                float distance = length(p - uRocks[i].xy) / uRocks[i].z;
                float noise = snoise(vec3(p * 5.0, uTime * 0.4 + float(i)));

                foam += 1.0 - smoothstep(1.0, 1.2 + noise * 0.08, distance);

                float ring = sin((distance - uTime * 0.25) * 9.0 + noise * 1.5) * 0.5 + 0.5;
                ripples += smoothstep(0.8, 0.95, ring) * (1.0 - smoothstep(1.1, 2.3, distance)) * step(1.0, distance);
            }
            color = mix(color, uFoamColor, clamp(foam, 0.0, 1.0) * uFoam);
            color = mix(color, uFoamColor, clamp(ripples, 0.0, 1.0) * uRipples * 0.5);

            // Surface normal wobbled by the pattern for reflections
            vec2 tilt = vec2(
                snoise(vec3(p * 3.0 - vec2(0.0, time * 2.0), uTime * 0.2)),
                snoise(vec3(p * 3.0 + 9.1 - vec2(0.0, time * 2.0), uTime * 0.2))
            ) * 0.08;
            vec3 normal = normalize(vec3(tilt.x, 1.0, tilt.y));
            vec3 viewDirection = normalize(vWorldPosition - cameraPosition);
            vec3 reflection = reflect(viewDirection, normal);

            // Evening sky at grazing angles
            float fresnel = pow(1.0 - max(dot(-viewDirection, normal), 0.0), 4.0);
            color = mix(color, uSkyColor, fresnel * uReflection);

            // Low sun behind the island: a soft warm sheen on the far water
            float sunSheen = pow(max(dot(reflection, uSunDirection), 0.0), 30.0);
            color = mix(color, uSunColor * 0.8, sunSheen * uSunReflection);

            // Green portal light streaking across the water
            vec3 toPortal = normalize(uPortalPosition - vWorldPosition);
            float portalGlow = pow(max(dot(reflection, toPortal), 0.0), 24.0);
            color += uPortalColor * portalGlow * uPortalReflection;

            // Sparkling glints (above 1 so the bloom catches them)
            float glint = snoise(vec3(p * 14.0, uTime * 1.5));
            glint = smoothstep(0.82, 0.95, glint) * smoothstep(-0.1, 0.4, pattern);
            color += uFoamColor * glint * uGlints;

            gl_FragColor = vec4(color, 1.0);

            #include <tonemapping_fragment>
            #include <colorspace_fragment>
        }
    `
})

gltfLoader.load(
    'japanese_portal_diorama/water.glb',
    (gltf) =>
    {
        gltf.scene.traverse((child) =>
        {
            if(child.isMesh)
                child.material = waterMaterial
        })
        scene.add(gltf.scene)
    }
)

/**
 * Stream mouth (the water volume seen through the cliff)
 */
const streamFrontParameters = {
    surfaceColor: '#3a7f78',
    depthColor: '#1c3f5c',
    foamColor: '#f4e2da'
}

const streamFrontMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms:
    {
        uTime: { value: 0 },
        uSurfaceColor: { value: new THREE.Color(streamFrontParameters.surfaceColor) },
        uDepthColor: { value: new THREE.Color(streamFrontParameters.depthColor) },
        uFoamColor: { value: new THREE.Color(streamFrontParameters.foamColor) },
        uOpacity: { value: 0.3 },
        uCutDepth: { value: 0.38 }
    },
    vertexShader: `
        varying vec2 vUv;

        void main()
        {
            // UV.x runs along the lip, UV.y is the depth below the surface (0 to 1), baked in Blender
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform float uTime;
        uniform vec3 uSurfaceColor;
        uniform vec3 uDepthColor;
        uniform vec3 uFoamColor;
        uniform float uOpacity;
        uniform float uCutDepth;

        varying vec2 vUv;

        ${simplexNoise}

        void main()
        {
            float depth = vUv.y;

            // Light green-teal at the surface sinking into a dark blue
            float swirl = snoise(vec3(vUv.x * 4.0, depth * 3.0, uTime * 0.15));
            vec3 color = mix(uSurfaceColor, uDepthColor, smoothstep(0.0, 0.7, depth + swirl * 0.08));

            // Faint caustic streaks near the top
            float caustic = smoothstep(0.55, 0.9, snoise(vec3(vUv.x * 9.0, depth * 5.0 - uTime * 0.2, uTime * 0.3)));
            color += uSurfaceColor * caustic * (1.0 - smoothstep(0.0, 0.5, depth)) * 0.35;

            // Bright meniscus where the surface meets the glass-like front
            float meniscus = 1.0 - smoothstep(0.0, 0.025, depth);
            color = mix(color, uFoamColor, meniscus * 0.6);

            // Ragged bottom edge dissolving into the rock where the cliff band ends, so the underside stays one stone
            float edge = 1.0 - smoothstep(uCutDepth - 0.08, uCutDepth, depth + swirl * 0.03);

            // See-through like a cut into the water: a light tint over the stream bed, with the meniscus and caustics staying opaque
            float alpha = uOpacity * mix(1.0, 0.6, smoothstep(0.0, 0.8, depth));
            alpha = max(alpha, meniscus * 0.9);
            alpha += caustic * (1.0 - smoothstep(0.0, 0.5, depth)) * 0.15;
            alpha *= edge;

            gl_FragColor = vec4(color, alpha);

            #include <tonemapping_fragment>
            #include <colorspace_fragment>
        }
    `
})

gltfLoader.load(
    'japanese_portal_diorama/stream_front.glb',
    (gltf) =>
    {
        gltf.scene.traverse((child) =>
        {
            if(child.isMesh)
            {
                child.material = streamFrontMaterial
                child.renderOrder = 1
            }
        })
        scene.add(gltf.scene)
    }
)

const streamFrontFolder = gui.addFolder('Stream front')
for(const key in streamFrontParameters)
{
    const uniformName = 'u' + key[0].toUpperCase() + key.slice(1)
    streamFrontFolder
        .addColor(streamFrontParameters, key)
        .onChange(() => streamFrontMaterial.uniforms[uniformName].value.set(streamFrontParameters[key]))
}
streamFrontFolder.add(streamFrontMaterial.uniforms.uOpacity, 'value').min(0).max(1).step(0.01).name('frontOpacity')
streamFrontFolder.add(streamFrontMaterial.uniforms.uCutDepth, 'value').min(0.1).max(1).step(0.01).name('cutDepth')

// Floating petals drifting downstream. The stream is a strip of cross sections, from the back pond to the front cliff
const streamSections = [
    [[2.9, -1.35], [2.45, -1.2]],
    [[3.35, -1.0], [2.05, -0.7]],
    [[3.5, -0.05], [1.7, 0.2]],
    [[3.25, 1.0], [1.3, 1.25]],
    [[3.1, 2.1], [0.8, 2.4]],
    [[3.15, 3.3], [0.3, 3.5]],
    [[3.6, 4.5], [-0.05, 4.5]],
    [[3.6, 4.8], [-0.05, 5.95]]
].map((section) => section.map(([x, z]) => new THREE.Vector2(x, z)))

// Distance travelled along the stream's middle at each section, so petals drift at an even pace
const streamDistances = [0]
for(let i = 1; i < streamSections.length; i++)
{
    const previous = new THREE.Vector2().addVectors(...streamSections[i - 1]).multiplyScalar(0.5)
    const current = new THREE.Vector2().addVectors(...streamSections[i]).multiplyScalar(0.5)
    streamDistances.push(streamDistances[i - 1] + previous.distanceTo(current))
}
const streamLength = streamDistances[streamDistances.length - 1]

const WATER_LEVEL = -0.28

const floatingPetalParameters = {
    count: 45,
    speed: 0.18
}

let floatingPetals = null
let floatingPetalData = []

const createFloatingPetals = () =>
{
    if(floatingPetals)
    {
        scene.remove(floatingPetals)
        floatingPetals.dispose()
    }

    floatingPetals = new THREE.InstancedMesh(petalGeometry, petalMaterial, floatingPetalParameters.count)
    floatingPetals.frustumCulled = false

    const colorA = new THREE.Color(petalParameters.colorA)
    const colorB = new THREE.Color(petalParameters.colorB)
    const color = new THREE.Color()

    floatingPetalData = []
    for(let i = 0; i < floatingPetalParameters.count; i++)
    {
        floatingPetalData.push({
            offset: Math.random(),
            lane: 0.12 + Math.random() * 0.76,
            speed: 0.7 + Math.random() * 0.6,
            spin: (Math.random() - 0.5) * 0.8,
            angle: Math.random() * Math.PI * 2,
            scale: 0.6 + Math.random() * 0.8,
            phase: Math.random() * Math.PI * 2
        })
        floatingPetals.setColorAt(i, color.lerpColors(colorA, colorB, Math.random()))
    }

    scene.add(floatingPetals)
}
createFloatingPetals()

const floatingPetalDummy = new THREE.Object3D()
const streamPoint = new THREE.Vector2()
const bankA = new THREE.Vector2()
const bankB = new THREE.Vector2()
const rockOffset = new THREE.Vector2()

const updateFloatingPetals = (elapsedTime) =>
{
    // Same base size as the petals in the air, which is only known once the model is in
    const baseScale = (petalArea ? petalArea.scale : 12) * petalParameters.size

    for(let i = 0; i < floatingPetalData.length; i++)
    {
        const petal = floatingPetalData[i]
        const progress = (petal.offset + elapsedTime * floatingPetalParameters.speed * petal.speed / streamLength) % 1
        const distance = progress * streamLength

        // Find the stream segment and blend its two banks
        let segment = 0
        while(segment < streamDistances.length - 2 && streamDistances[segment + 1] < distance)
            segment++
        const t = (distance - streamDistances[segment]) / (streamDistances[segment + 1] - streamDistances[segment])
        bankA.lerpVectors(streamSections[segment][0], streamSections[segment + 1][0], t)
        bankB.lerpVectors(streamSections[segment][1], streamSections[segment + 1][1], t)

        // Meander a little across the lane
        const lane = petal.lane + Math.sin(elapsedTime * 0.4 + petal.phase) * 0.06
        streamPoint.lerpVectors(bankA, bankB, lane)

        // Slide around the rocks instead of through them
        for(const rock of waterRocks)
        {
            rockOffset.set(streamPoint.x - rock.x, streamPoint.y - rock.y)
            const length = rockOffset.length()
            const clearance = rock.z * 1.15
            if(length < clearance)
                streamPoint.addScaledVector(rockOffset.normalize(), clearance - length)
        }

        // Grow in at the pond and shrink out over the cliff edge
        const fade = Math.min(progress / 0.05, 1, (1 - progress) / 0.03)

        floatingPetalDummy.position.set(streamPoint.x, WATER_LEVEL + 0.004, streamPoint.y)
        floatingPetalDummy.rotation.set(
            -Math.PI * 0.5 + Math.sin(elapsedTime * 1.3 + petal.phase) * 0.08,
            0,
            petal.angle + elapsedTime * petal.spin,
            'YXZ'
        )
        floatingPetalDummy.scale.setScalar(baseScale * petal.scale * fade)
        floatingPetalDummy.updateMatrix()
        floatingPetals.setMatrixAt(i, floatingPetalDummy.matrix)
    }
    floatingPetals.instanceMatrix.needsUpdate = true
}

const waterFolder = gui.addFolder('Water')
for(const key in waterParameters)
{
    const uniformName = 'u' + key[0].toUpperCase() + key.slice(1)
    waterFolder
        .addColor(waterParameters, key)
        .onChange(() => waterMaterial.uniforms[uniformName].value.set(waterParameters[key]))
}
waterFolder.add(waterMaterial.uniforms.uFlowSpeed, 'value').min(0).max(1).step(0.001).name('flowSpeed')
waterFolder.add(waterMaterial.uniforms.uNoiseScale, 'value').min(0.2).max(5).step(0.01).name('noiseScale')
waterFolder.add(waterMaterial.uniforms.uShoreWidth, 'value').min(0).max(1).step(0.001).name('shoreWidth')
waterFolder.add(waterMaterial.uniforms.uFoam, 'value').min(0).max(1).step(0.01).name('foam')
waterFolder.add(waterMaterial.uniforms.uRipples, 'value').min(0).max(2).step(0.01).name('ripples')
waterFolder.add(waterMaterial.uniforms.uReflection, 'value').min(0).max(1).step(0.01).name('skyReflection')
waterFolder.add(waterMaterial.uniforms.uSunReflection, 'value').min(0).max(1).step(0.01).name('sunReflection')
waterFolder.add(waterMaterial.uniforms.uPortalReflection, 'value').min(0).max(4).step(0.01).name('portalReflection')
waterFolder.add(waterMaterial.uniforms.uGlints, 'value').min(0).max(4).step(0.01).name('glints')
waterFolder.add(floatingPetalParameters, 'count').min(0).max(200).step(1).name('floatingPetals').onFinishChange(createFloatingPetals)
waterFolder.add(floatingPetalParameters, 'speed').min(0).max(1).step(0.001).name('petalDrift')

/**
 * Clouds (smoky mist wrapping the underside of the island)
 */
const cloudParameters = {
    count: 102,
    size: 1.42,
    spread: 1.07,
    drift: 0.025,
    lightColor: '#924534',
    midColor: '#3e1a33',
    shadowColor: '#482855'
}

// The island's solid parts are also drawn into this depth-only layer, so the mist can fade where it meets the rock
const CLOUD_DEPTH_LAYER = 1
const cloudDepthTarget = new THREE.WebGLRenderTarget(1, 1, {
    depthTexture: new THREE.DepthTexture(1, 1)
})
const cloudDepthMaterial = new THREE.MeshBasicMaterial({ colorWrite: false })

const cloudMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms:
    {
        uTime: { value: 0 },
        uSpeed: { value: 0.052 },
        uOpacity: { value: 0.32 },
        // World units: how far behind the mist the rock has to be before it shows through fully
        uSoftness: { value: 0.32 },
        uLightColor: { value: new THREE.Color(cloudParameters.lightColor) },
        uMidColor: { value: new THREE.Color(cloudParameters.midColor) },
        uShadowColor: { value: new THREE.Color(cloudParameters.shadowColor) },
        uDepth: { value: cloudDepthTarget.depthTexture },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uCameraNear: { value: 0.1 },
        uCameraFar: { value: 100 }
    },
    vertexShader: `
        // x: seed, y: width stretch, z: opacity
        attribute vec3 aCloud;

        varying vec2 vUv;
        varying float vSeed;
        varying float vOpacity;
        varying float vViewDepth;

        void main()
        {
            // Billboard: the quad always faces the camera, stretched sideways into a wide wisp
            vec4 viewCenter = viewMatrix * modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
            float scale = length(instanceMatrix[0].xyz);
            vec4 viewPosition = viewCenter + vec4(position.xy * vec2(aCloud.y, 1.0) * scale, 0.0, 0.0);
            gl_Position = projectionMatrix * viewPosition;

            vUv = uv;
            vSeed = aCloud.x;
            vOpacity = aCloud.z;
            vViewDepth = -viewPosition.z;
        }
    `,
    fragmentShader: `
        #include <packing>

        uniform float uTime;
        uniform float uSpeed;
        uniform float uOpacity;
        uniform float uSoftness;
        uniform vec3 uLightColor;
        uniform vec3 uMidColor;
        uniform vec3 uShadowColor;
        uniform sampler2D uDepth;
        uniform vec2 uResolution;
        uniform float uCameraNear;
        uniform float uCameraFar;

        varying vec2 vUv;
        varying float vSeed;
        varying float vOpacity;
        varying float vViewDepth;

        ${simplexNoise}

        float fbm(vec3 p, int octaves)
        {
            float value = 0.0;
            float amplitude = 0.5;
            for(int i = 0; i < 5; i++)
            {
                if(i >= octaves)
                    break;
                value += amplitude * snoise(p);
                p = p * 2.03 + vec3(4.1, -2.3, 1.7);
                amplitude *= 0.5;
            }
            return value;
        }

        // Smoke: a soft blob whose outline is torn into curling wisps by domain-warped noise
        float density(vec2 p, vec2 warp, float time)
        {
            vec2 flow = p + warp * 0.25 + vec2(0.0, -time * 0.3);
            float billows = fbm(vec3(flow * 1.4 + vSeed * 31.0, time * 0.5 + vSeed * 7.0), 3);
            float wisps = fbm(vec3(flow * 3.5 + vSeed * 17.0, time * 0.8), 2);
            float falloff = 1.0 - length(p * vec2(1.0, 1.25));
            return falloff * 1.3 + billows * 0.9 + wisps * 0.15 - 0.15;
        }

        void main()
        {
            float time = uTime * uSpeed;
            vec2 p = vUv * 2.0 - 1.0;

            // Slow swirling warp shared by both density samples
            vec3 warpInput = vec3(p * 1.2 + vSeed * 13.0, time * 0.5);
            vec2 warp = vec2(fbm(warpInput, 2), fbm(warpInput + vec3(5.2, 1.3, 0.0), 2));

            float smoke = density(p, warp, time);
            float alpha = smoothstep(0.0, 0.6, smoke) * (1.0 - smoothstep(0.7, 1.0, length(p)));
            if(alpha < 0.003)
                discard;

            // Self shadowing: more smoke towards the light (up and to the right, where the sun sets) means shade
            float towardsLight = density(p + vec2(0.1, 0.18), warp, time);
            float light = clamp(0.4 + (smoke - towardsLight) * 1.2, 0.0, 1.0);

            // Lit from above by the evening sky, heavier underneath
            light *= mix(0.3, 1.0, smoothstep(-0.9, 0.7, p.y));

            // Same palette as the painted sea of clouds: violet shade, lavender body, peach sunlit tops
            vec3 color = mix(uShadowColor, uMidColor, smoothstep(0.0, 0.55, light));
            color = mix(color, uLightColor, smoothstep(0.55, 1.0, light));

            // Thin wisps take on the lavender of the sky behind them
            color = mix(color, uMidColor, (1.0 - alpha) * 0.3);

            // Soft particles: fade out as the mist gets close to the rock behind it
            float sceneDepth = texture2D(uDepth, gl_FragCoord.xy / uResolution).x;
            float sceneViewDepth = -perspectiveDepthToViewZ(sceneDepth, uCameraNear, uCameraFar);
            float soft = clamp((sceneViewDepth - vViewDepth) / uSoftness, 0.0, 1.0);

            gl_FragColor = vec4(color, alpha * soft * vOpacity * uOpacity);

            #include <tonemapping_fragment>
            #include <colorspace_fragment>
        }
    `
})

let clouds = null
let cloudData = []
let cloudArea = null
const cloudOccluders = []

// Solid parts of the island: they occlude the mist and define where it gathers
const addCloudOccluder = (object) =>
{
    object.traverse((child) =>
    {
        if(child.isMesh)
            child.layers.enable(CLOUD_DEPTH_LAYER)
    })
    cloudOccluders.push(object)
    createClouds()
}

const CLOUD_PROFILE_BINS = 24

// How far the island reaches out from its center at each height, measured from its vertices
const measureIsland = () =>
{
    const bounds = new THREE.Box3()
    for(const object of cloudOccluders)
        bounds.expandByObject(object)
    const center = bounds.getCenter(new THREE.Vector3())

    const profile = new Array(CLOUD_PROFILE_BINS).fill(0)
    const vertex = new THREE.Vector3()
    for(const object of cloudOccluders)
    {
        object.updateWorldMatrix(true, true)
        object.traverse((child) =>
        {
            if(!child.isMesh)
                return
            const positions = child.geometry.attributes.position
            for(let i = 0; i < positions.count; i++)
            {
                vertex.fromBufferAttribute(positions, i).applyMatrix4(child.matrixWorld)
                const bin = Math.min(Math.floor((vertex.y - bounds.min.y) / (bounds.max.y - bounds.min.y) * CLOUD_PROFILE_BINS), CLOUD_PROFILE_BINS - 1)
                profile[bin] = Math.max(profile[bin], Math.hypot(vertex.x - center.x, vertex.z - center.z))
            }
        })
    }

    return {
        center,
        bottom: bounds.min.y,
        // The diorama's origin sits on the ground surface: the rock is everything below it
        height: -bounds.min.y,
        radiusAt: (y) =>
        {
            const bin = Math.floor((y - bounds.min.y) / (bounds.max.y - bounds.min.y) * CLOUD_PROFILE_BINS)
            return profile[THREE.MathUtils.clamp(bin, 0, CLOUD_PROFILE_BINS - 1)]
        }
    }
}

const createClouds = () =>
{
    if(!cloudOccluders.length)
        return

    cloudArea = measureIsland()
    const { bottom, height } = cloudArea

    // The cliff shade reaches its darkest at the tip of the rock
    gradeUniforms.uGradeDepth.value = height

    if(clouds)
    {
        scene.remove(clouds)
        clouds.dispose()
    }

    const geometry = new THREE.PlaneGeometry(1, 1)
    geometry.setAttribute('aCloud', new THREE.InstancedBufferAttribute(new Float32Array(cloudParameters.count * 3), 3))
    clouds = new THREE.InstancedMesh(geometry, cloudMaterial, cloudParameters.count)
    clouds.frustumCulled = false

    cloudData = []
    for(let i = 0; i < cloudParameters.count; i++)
    {
        const progress = i / cloudParameters.count

        // Veil: thinner wisps on the camera side (+z), rising up the rock face in front of it
        const veil = progress >= 0.7
        // Otherwise a thick collar around the lower rock, with a few puffs pooling beneath its tip
        const level = veil
            ? 0.5 + Math.random() * 0.3
            : progress < 0.15 ? Math.random() * 0.1 : 0.08 + Math.pow(Math.random(), 1.3) * 0.45
        const y = bottom + height * level
        const rockRadius = cloudArea.radiusAt(y)
        cloudData.push({
            veil,
            angle: veil ? Math.PI * 0.5 + (Math.random() - 0.5) * 2.2 : Math.random() * Math.PI * 2,
            // Just outside the rock face, so the mist drapes over it without hiding inside it
            radius: (rockRadius * (veil ? 1.02 + Math.random() * 0.2 : 0.9 + Math.random() * 0.25) + height * 0.04) * cloudParameters.spread,
            y,
            size: height * cloudParameters.size * (veil ? 0.3 + Math.random() * 0.25 : 0.4 + Math.random() * 0.3),
            stretch: veil ? 1.5 + Math.random() * 0.8 : 1.2 + Math.random() * 0.7,
            opacity: veil ? 0.55 + Math.random() * 0.3 : 0.75 + Math.random() * 0.25,
            seed: Math.random(),
            speed: (0.7 + Math.random() * 0.6) * (Math.random() < 0.5 ? -1 : 1),
            phase: Math.random() * Math.PI * 2,
            position: new THREE.Vector3(),
            distance: 0
        })
    }

    scene.add(clouds)
}

const cloudDummy = new THREE.Object3D()

const updateClouds = (elapsedTime) =>
{
    cloudMaterial.uniforms.uTime.value = elapsedTime
    cloudMaterial.uniforms.uCameraNear.value = camera.near
    cloudMaterial.uniforms.uCameraFar.value = camera.far

    if(!clouds)
        return

    // Slowly orbit and bob around the island
    const { center, height } = cloudArea
    for(const cloud of cloudData)
    {
        // The veil sways in front of the rock instead of circling away from it
        const angle = cloud.veil
            ? cloud.angle + Math.sin(elapsedTime * cloudParameters.drift * cloud.speed * 4 + cloud.phase) * 0.2
            : cloud.angle + elapsedTime * cloudParameters.drift * cloud.speed
        cloud.position.set(
            center.x + Math.cos(angle) * cloud.radius,
            cloud.y + Math.sin(elapsedTime * 0.3 + cloud.phase) * height * 0.02,
            center.z + Math.sin(angle) * cloud.radius
        )
        cloud.distance = cloud.position.distanceToSquared(camera.position)
    }

    // Instances aren't sorted by three.js: draw the farthest first so the transparency layers correctly
    cloudData.sort((a, b) => b.distance - a.distance)

    const attribute = clouds.geometry.attributes.aCloud
    for(let i = 0; i < cloudData.length; i++)
    {
        const cloud = cloudData[i]
        cloudDummy.position.copy(cloud.position)
        cloudDummy.scale.setScalar(cloud.size)
        cloudDummy.updateMatrix()
        clouds.setMatrixAt(i, cloudDummy.matrix)
        attribute.setXYZ(i, cloud.seed, cloud.stretch, cloud.opacity)
    }
    clouds.instanceMatrix.needsUpdate = true
    attribute.needsUpdate = true
}

const renderCloudDepth = () =>
{
    camera.layers.set(CLOUD_DEPTH_LAYER)
    scene.overrideMaterial = cloudDepthMaterial
    renderer.setRenderTarget(cloudDepthTarget)
    renderer.clear()
    renderer.render(scene, camera)
    renderer.setRenderTarget(null)
    scene.overrideMaterial = null
    camera.layers.set(0)
}

const updateCloudResolution = () =>
{
    const pixelRatio = Math.min(window.devicePixelRatio, 2)
    cloudDepthTarget.setSize(sizes.width * pixelRatio, sizes.height * pixelRatio)
    cloudMaterial.uniforms.uResolution.value.set(sizes.width * pixelRatio, sizes.height * pixelRatio)
}

const cloudsFolder = gui.addFolder('Clouds')
cloudsFolder.add(cloudParameters, 'count').min(0).max(120).step(1).onFinishChange(createClouds)
cloudsFolder.add(cloudParameters, 'size').min(0.2).max(3).step(0.01).onFinishChange(createClouds)
cloudsFolder.add(cloudParameters, 'spread').min(0.5).max(2).step(0.01).onFinishChange(createClouds)
cloudsFolder.add(cloudParameters, 'drift').min(0).max(0.2).step(0.001)
cloudsFolder.add(cloudMaterial.uniforms.uSpeed, 'value').min(0).max(0.5).step(0.001).name('billowSpeed')
cloudsFolder.add(cloudMaterial.uniforms.uOpacity, 'value').min(0).max(1).step(0.01).name('opacity')
cloudsFolder.add(cloudMaterial.uniforms.uSoftness, 'value').min(0.01).max(3).step(0.01).name('softness')
for(const key of ['lightColor', 'midColor', 'shadowColor'])
{
    const uniformName = 'u' + key[0].toUpperCase() + key.slice(1)
    cloudsFolder
        .addColor(cloudParameters, key)
        .onChange(() => cloudMaterial.uniforms[uniformName].value.set(cloudParameters[key]))
}
cloudsFolder.add({ regenerate: createClouds }, 'regenerate')

undersidePromise.then(addCloudOccluder)

/**
 * Sizes
 */
const sizes = {
    width: window.innerWidth,
    height: window.innerHeight
}

window.addEventListener('resize', () =>
{
    // Update sizes
    sizes.width = window.innerWidth
    sizes.height = window.innerHeight

    // Update camera
    camera.aspect = sizes.width / sizes.height
    camera.updateProjectionMatrix()

    // Update renderer
    renderer.setSize(sizes.width, sizes.height)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

    // Update effect composer
    effectComposer.setSize(sizes.width, sizes.height)
    effectComposer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

    updateEnergyResolution()
    updateCloudResolution()
})

/**
 * Camera
 */
// Base camera
const camera = new THREE.PerspectiveCamera(45, sizes.width / sizes.height, 0.1, 100)
camera.position.x = 4
camera.position.y = 2
camera.position.z = 4
scene.add(camera)

// Controls
const controls = new OrbitControls(camera, canvas)
controls.enableDamping = true
controls.enablePan = false
controls.enableZoom = false

/**
 * Renderer
 */
const renderer = new THREE.WebGLRenderer({
    canvas: canvas,
    antialias: false
})
renderer.setSize(sizes.width, sizes.height)
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
updateEnergyResolution()
updateCloudResolution()

/**
 * Post processing
 */
// The renderer's antialias flag doesn't apply to the composer's render targets, so enable MSAA on them
const renderTarget = new THREE.WebGLRenderTarget(800, 600, {
    type: THREE.HalfFloatType,
    samples: 8
})
const effectComposer = new EffectComposer(renderer, renderTarget)
effectComposer.setSize(sizes.width, sizes.height)
effectComposer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

effectComposer.addPass(new RenderPass(scene, camera))

// Strength, radius, threshold
const bloomPass = new UnrealBloomPass(new THREE.Vector2(sizes.width, sizes.height), 0.34, 0.46, 0.67)
effectComposer.addPass(bloomPass)

effectComposer.addPass(new OutputPass())

// SMAA runs after the output pass so it works on the final sRGB colors, softening what MSAA misses (shader edges, thin details)
const smaaPass = new SMAAPass(sizes.width * renderer.getPixelRatio(), sizes.height * renderer.getPixelRatio())
effectComposer.addPass(smaaPass)

// Final grade, on the display colors like a film look: sun haze, split toning, vignette and grain
const filmParameters = {
    veilColor: '#ffb07a',
    shadowTint: '#4b3a86',
    highlightTint: '#ffc69a',
    vignetteColor: '#1a0f2e'
}

const filmPass = new ShaderPass({
    uniforms:
    {
        tDiffuse: { value: null },
        uTime: { value: 0 },
        uAspect: { value: sizes.width / sizes.height },
        uSunScreen: { value: new THREE.Vector2(0.6, 0.8) },
        uSunVisible: { value: 1 },
        uVeilColor: { value: new THREE.Color(filmParameters.veilColor) },
        uVeil: { value: 0.29 },
        uVeilFalloff: { value: 0.5 },
        uShadowTint: { value: new THREE.Color(filmParameters.shadowTint) },
        uHighlightTint: { value: new THREE.Color(filmParameters.highlightTint) },
        uSplitTone: { value: 0.495 },
        uContrast: { value: 0.32 },
        uSaturation: { value: 1.17 },
        uVignetteColor: { value: new THREE.Color(filmParameters.vignetteColor) },
        uVignette: { value: 0.69 },
        uGrain: { value: 0.054 }
    },
    vertexShader: `
        varying vec2 vUv;

        void main()
        {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float uTime;
        uniform float uAspect;
        uniform vec2 uSunScreen;
        uniform float uSunVisible;
        uniform vec3 uVeilColor;
        uniform float uVeil;
        uniform float uVeilFalloff;
        uniform vec3 uShadowTint;
        uniform vec3 uHighlightTint;
        uniform float uSplitTone;
        uniform float uContrast;
        uniform float uSaturation;
        uniform vec3 uVignetteColor;
        uniform float uVignette;
        uniform float uGrain;

        varying vec2 vUv;

        const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

        float hash(vec2 p)
        {
            vec3 p3 = fract(vec3(p.xyx) * 0.1031);
            p3 += dot(p3, p3.yzx + 33.33);
            return fract((p3.x + p3.y) * p3.z);
        }

        void main()
        {
            // The half float buffer still holds values above 1 (bloom, glints): clip like the display would, before the curves
            vec3 color = clamp(texture2D(tDiffuse, vUv).rgb, 0.0, 1.0);

            // Warm veil scattering out of the sun, laid over everything so the island shares the backdrop's air
            vec2 toSun = (vUv - uSunScreen) * vec2(uAspect, 1.0);
            float veil = exp(-length(toSun) * uVeilFalloff) * uVeil * uSunVisible;
            color = 1.0 - (1.0 - color) * (1.0 - uVeilColor * veil);

            // Gentle S curve
            color = mix(color, color * color * (3.0 - 2.0 * color), uContrast);

            // Split toning: violet in the shadows, peach in the highlights (hue only, brightness is kept)
            float luma = dot(color, LUMA);
            vec3 shadowShift = uShadowTint - dot(uShadowTint, LUMA);
            vec3 highlightShift = uHighlightTint - dot(uHighlightTint, LUMA);
            color += shadowShift * (1.0 - smoothstep(0.0, 0.55, luma)) * uSplitTone;
            color += highlightShift * smoothstep(0.45, 1.0, luma) * uSplitTone;

            luma = dot(color, LUMA);
            color = mix(vec3(luma), color, uSaturation);

            // Vignette falling off into deep plum rather than black
            vec2 centered = (vUv - 0.5) * vec2(uAspect, 1.0);
            float vignette = smoothstep(0.35, 1.15, length(centered));
            color = mix(color, color * uVignetteColor * 2.0, vignette * uVignette);

            // Fine animated grain, strongest in the midtones
            float grain = hash(gl_FragCoord.xy + fract(uTime * 7.3) * 431.0) - 0.5;
            color += grain * uGrain * (1.0 - abs(luma - 0.5) * 1.2);

            gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
        }
    `
})
effectComposer.addPass(filmPass)

// Follow the painted sun on screen as the camera orbits
const sunScreenPosition = new THREE.Vector3()
const updateSunScreen = () =>
{
    sunScreenPosition.copy(backdropSunDirection).multiplyScalar(camera.far * 0.5).add(camera.position).project(camera)
    filmPass.uniforms.uSunScreen.value.set(sunScreenPosition.x * 0.5 + 0.5, sunScreenPosition.y * 0.5 + 0.5)
    filmPass.uniforms.uSunVisible.value = sunScreenPosition.z < 1 ? 1 : 0
    filmPass.uniforms.uAspect.value = sizes.width / sizes.height
}

const filmFolder = gui.addFolder('Film grade')
for(const key in filmParameters)
{
    const uniformName = 'u' + key[0].toUpperCase() + key.slice(1)
    filmFolder
        .addColor(filmParameters, key)
        .onChange(() => filmPass.uniforms[uniformName].value.set(filmParameters[key]))
}
filmFolder.add(filmPass, 'enabled')
filmFolder.add(filmPass.uniforms.uVeil, 'value').min(0).max(1).step(0.01).name('sunVeil')
filmFolder.add(filmPass.uniforms.uVeilFalloff, 'value').min(0.5).max(8).step(0.01).name('veilFalloff')
filmFolder.add(filmPass.uniforms.uSplitTone, 'value').min(0).max(0.5).step(0.001).name('splitTone')
filmFolder.add(filmPass.uniforms.uContrast, 'value').min(-0.5).max(1).step(0.01).name('contrast')
filmFolder.add(filmPass.uniforms.uSaturation, 'value').min(0).max(2).step(0.01).name('saturation')
filmFolder.add(filmPass.uniforms.uVignette, 'value').min(0).max(1).step(0.01).name('vignette')
filmFolder.add(filmPass.uniforms.uGrain, 'value').min(0).max(0.1).step(0.001).name('grain')

const antialiasParameters = { msaaSamples: renderTarget.samples }

const antialiasFolder = gui.addFolder('Antialias')
antialiasFolder
    .add(antialiasParameters, 'msaaSamples', [0, 2, 4, 8])
    .onChange((samples) =>
    {
        // Render targets are re-created on the next render after being disposed
        for(const target of [effectComposer.renderTarget1, effectComposer.renderTarget2])
        {
            target.samples = samples
            target.dispose()
        }
    })
antialiasFolder.add(smaaPass, 'enabled').name('smaa')

const bloomFolder = gui.addFolder('Bloom')
bloomFolder.add(bloomPass, 'enabled')
bloomFolder.add(bloomPass, 'strength').min(0).max(3).step(0.01)
bloomFolder.add(bloomPass, 'radius').min(0).max(1).step(0.01)
bloomFolder.add(bloomPass, 'threshold').min(0).max(2).step(0.01)

/**
 * Animate
 */
const clock = new THREE.Clock()
let previousTime = 0

const tick = () =>
{
    const elapsedTime = clock.getElapsedTime()
    const deltaTime = Math.min(elapsedTime - previousTime, 0.1)
    previousTime = elapsedTime

    // Update controls
    controls.update()

    // Lantern flicker
    const flicker = 1 + Math.sin(elapsedTime * 9) * 0.04 + Math.sin(elapsedTime * 23.7) * 0.03
    lightMaterials.lantern.color
        .set(lightParameters.lanternColor)
        .multiplyScalar(lightParameters.lanternIntensity * flicker)

    // Portal flow
    portalMaterial.uniforms.uTime.value = elapsedTime
    updatePortalEnergy(elapsedTime, deltaTime)

    // Water flow
    waterMaterial.uniforms.uTime.value = elapsedTime
    streamFrontMaterial.uniforms.uTime.value = elapsedTime
    updateFloatingPetals(elapsedTime)

    // Clouds
    updateClouds(elapsedTime)
    renderCloudDepth()

    // Film grade
    filmPass.uniforms.uTime.value = elapsedTime
    updateSunScreen()

    // Render
    effectComposer.render()

    // Call tick again on the next frame
    window.requestAnimationFrame(tick)
}

tick()