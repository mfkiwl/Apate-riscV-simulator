import {SVGLoader} from "./SVGLoader";
import RISC_SVG from '!!raw-loader!./risc_test.svg';
import {
  BufferGeometry,
  Color,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshLambertMaterial,
  Vector2,
  Vector3
} from "THREE";
import {checkColor, flattenRootToIndexIdArray, IdFlatInterface} from "./helpers";
import {computeUVsOfPlane} from "./helper3D";
import {getSName} from "./helperNameMatch";
import {MeshText2D, textAlign} from "three-text2d";
import * as d3 from "d3";
import * as tinycolor from 'tinycolor2';
import {Bindings, CPU_STATES} from "../bindingSubjects";
import {hideNonVisibleElements, setOpacity} from "./helperVisibility";
import * as _ from "lodash";


export default function initiateSVGObjects(): { idRoot; idFlat; renderGroup } {
  const loader = new SVGLoader();
  const idRoot = loader.parse(RISC_SVG).root;
  const renderGroup = new Group();

  // SVG transforms -> boundingBox may not be accurate use centerOfMeshes instead
  renderGroup.scale.multiplyScalar(0.25);
  renderGroup.position.x = 0;
  renderGroup.position.y = 0;
  renderGroup.scale.y *= -1;

  idRoot.group = renderGroup;

  const generateChildren = (children, childGroup) => {
    for (const child of children) {
      // Only generate meshes for non idRoot as in elements which have no children
      if (!child.children) {
        if (child.path) {
          const path = child.path;
          const meshes: Mesh[] = [];

          if (path.userData.style.fill && path.userData.style.fill !== 'none') { // && child.id === 'alu'
            const fillColor = tinycolor(checkColor(path.userData.style.fill));

            const shapes = path.toShapes(true);
            for (let j = 0; j < shapes.length; j++) {
              const material = new MeshLambertMaterial({
                color: new Color().setStyle(fillColor.toHexString()),
                opacity: (path.userData.style.fillOpacity !== undefined ? path.userData.style.fillOpacity : 1) * (path.userData.style.opacity !== undefined ? path.userData.style.opacity : 1) * fillColor.getAlpha(),
                transparent: true
              });

              const shape = shapes[j];
              // const geometry = new ShapeGeometry(shape);
              const geometry = new ExtrudeGeometry(shape, {depth: 50, bevelEnabled: false});

              // Compute uvs
              computeUVsOfPlane(geometry);

              // const shaderMaterial = new ShaderMaterial({
              //   vertexShader: V_SHADER,
              //   fragmentShader: F_SHADER,
              //   uniforms: {
              //     u_backgroundColor: {value: new Color().setStyle(fillColor.toHexString())},
              //     u_borderColor: {value: new Color(1, 1, 1)},
              //     u_width: {value: range.x}, // Set size
              //     u_height: {value: range.y},
              //     ...this.globalUniforms
              //   }
              // });

              const mesh = new Mesh(geometry, material);
              mesh.translateZ(-51); // Compensate depth of extruded element and behind strokes

              mesh.name = child.id;
              childGroup.add(mesh);
              meshes.push(mesh);
            }
          }
          if (path.userData.style.stroke && path.userData.style.stroke !== 'none') {
            const strokeColor = tinycolor(checkColor(path.userData.style.stroke));
            const material1 = new MeshLambertMaterial({
              color: new Color().setStyle(strokeColor.toHexString()),
              opacity: path.userData.style.strokeOpacity * (path.userData.style.opacity ? path.userData.style.opacity : 1) * strokeColor.getAlpha(),
              transparent: true,
              side: DoubleSide,
              depthWrite: false
            });

            for (let j = 0, jl = path.subPaths.length; j < jl; j++) {
              const subPath = path.subPaths[j];
              const geometry = SVGLoader.pointsToStroke(subPath.getPoints(), path.userData.style);
              if (geometry) {
                const mesh = new Mesh(geometry, material1);
                childGroup.add(mesh);
                mesh.name = child.id;
                meshes.push(mesh);
              }
            }
          }
          child.meshes = meshes;
          child.group = childGroup;
          child.isGroup = false;
        }
        if (child.text) {
          const style = child.text.userData.style;
          const text = new MeshText2D(child.text.text, {
            align: new Vector2(1, 1.7), // Point is a bit further down
            font: (style.fontWeight ? style.fontWeight : '') + ' ' + style.fontSize * 4 + 'px ' + style.fontFamily,
            fillStyle: style.fill,
            antialias: true,
          });

          text.scale.set(0.25, -0.25, 0.25);
          text.position.copy(child.text.userData.position)

          // Render that text
          childGroup.add(text);

          // Store it for us to
          child.meshes = [];
          child.meshes.push(text.mesh);
          child.isGroup = false;
          child.group = childGroup;
        }
      } else {
        const newChildGroup = new Group();
        newChildGroup.name = child.id;
        child.group = newChildGroup;
        child.isGroup = true;
        generateChildren(child.children, newChildGroup);
        childGroup.add(newChildGroup);
      }
    }
  };

  generateChildren(idRoot.children, renderGroup);

  const idFlat = flattenRootToIndexIdArray(idRoot);

  hideNonVisibleElements(idFlat);

  /**
   * Moves meshes inside a "bg_" element 2 units to the back
   * @param idFlat
   */
  const setBackBackgroundElements = (idFlat: IdFlatInterface) => {
    for (const key of Object.keys(idFlat)) {
      if (key.startsWith('bg_')) {
        idFlat[key].meshes.forEach(mesh => {
          mesh.position.multiply(new Vector3(0, 0, 2));
        })
      }
    }
  }

  setBackBackgroundElements(idFlat);

  return {idFlat, idRoot, renderGroup}
}

export function updateActiveElements(cpuBindings: Bindings, idFlat: IdFlatInterface, animateTransition: boolean) {
  const nextCpuState = cpuBindings.nextCpuState.value;

  // Reset all lines
  // Dont show any active lines
  if (nextCpuState === CPU_STATES.FETCH) {
    for (const key of Object.keys(idFlat)) {
      // Hide all elements when the next decoding stage is incoming
      if (key.startsWith('mux_')) {
        setOpacity(idFlat[key].meshes, 1, animateTransition);
      }
    }
    // Reset all values
    cpuBindings.clearAllVolatileValues();
  }

  // Show decoded active lines if the current executed state was decoding
  if (cpuBindings.instruction.value) {

    /**
     * Checks the idFlat list for mux elements with the given element name.
     * @param element Name which should be included in the id -> 'add' to match 'mux_xor_add' or 'mux_add_lui'
     */
    const checkActiveElementsInGraph = (element: string) => {
      const meshesToActivate = [];
      for (const key of Object.keys(idFlat)) {
        // Only match exact word -> 'add' -> match 'add' and not 'addi'
        const regex = new RegExp(`(\b|_)${element.toLowerCase()}(\b|_|$|-)`);
        const keySmall = key.toLowerCase();
        if (keySmall.startsWith('mux_') && regex.test(keySmall)) {
          meshesToActivate.push(...idFlat[key].meshes)
        }
      }
      return meshesToActivate;
    };

    // Get list with meshes to activate
    const meshesToActivate = [];
    meshesToActivate.push(...checkActiveElementsInGraph(cpuBindings.instruction.value?.opcodeName));
    meshesToActivate.push(...checkActiveElementsInGraph(cpuBindings.instruction.value?.instructionName));
    // Deactivate all elements with 'mux_' which are currently not on if there are some to activate
    const allMeshes = [];
    for (const key of Object.keys(idFlat)) {
      const keySmall = key.toLowerCase();
      if (keySmall.startsWith('mux_')) {
        allMeshes.push(...idFlat[key].meshes);
      }
    }
    setOpacity(_.difference(allMeshes, meshesToActivate), 0.05, animateTransition);
  }
  console.log("Updated active elements with instruction ", cpuBindings.instruction.value);
}

export function addSignalTextsAndUpdate(cpuBindings: Bindings, idFlat: IdFlatInterface) {
  for (const key of Object.keys(idFlat)) {

    if (!idFlat[key]?.meshes[0]) {
      continue;
    }

    const meshOfSignal = idFlat[key].meshes[0];
    let signalName = getSName(meshOfSignal.name);

    if (signalName) {
      // This is a string, tell typescript
      signalName = signalName as string;

      const geometry = (meshOfSignal.geometry as BufferGeometry);
      const renderGroup = idFlat[key].group;
      const meshes = idFlat[key].meshes;

      const text = new MeshText2D(signalName, {
        align: textAlign.left,
        font: '50px Roboto',
        fillStyle: '#ffffff',
        antialias: true
      });
      text.scale.set(0.25, -0.25, 0.25);

      // Get position from signal
      const positions = [];
      for (let i = 0; i < geometry.attributes.position.count; i++) {
        positions.push({
          x: geometry.attributes.position.array[i * 3],
          y: geometry.attributes.position.array[i * 3 + 1],
          z: geometry.attributes.position.array[i * 3 + 2]
        });
      }
      const leftes = d3.scan(positions, (a, b) => a.x - b.x);
      text.position.set(positions[leftes].x + 3, positions[leftes].y + 2, positions[leftes].z);

      const binding = cpuBindings.allValues[signalName];
      if (binding) {
        binding.subscribe((value) => {
          text.text = (value === null || value === undefined) ? 'NaN' : value.toString();
        });
      }

      renderGroup.add(text);
      meshes.push(text.mesh);
    }
  }
}
