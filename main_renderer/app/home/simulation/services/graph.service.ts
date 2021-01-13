import {Injectable, NgZone} from '@angular/core';
import {
  AmbientLight,
  Clock,
  DirectionalLight,
  Light,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  RepeatWrapping,
  Scene,
  TextureLoader,
  Vector2,
  WebGLRenderer
} from 'three';
import panzoom from '../../../utils/drag.js';
import {CPUService} from './cpu.service';
import BACKGROUND_IMAGE from 'assets/background.png';
import {animate, linear} from 'popmotion';
import tippy, {Instance, Props} from 'tippy.js';
import RISCV_DEFINITIONS from '../../../yamls/risc.yml';
import TABS from '../../../yamls/tabs.yml';
import {Areas, getCenterOfMeshes, IdFlatInterface, IdRootInterface, Signal} from './graphHelpers/helpers';
import {centerCameraOnElement, focusCameraOnElement, forceStopFocus} from './graphHelpers/helperFocus';
import {hideElement, showElement} from './graphHelpers/helperVisibility';
import {getModuleName, getPortName, getSName, getWName} from './graphHelpers/helperNameMatch';
import initiateSVGObjects, {
  addSignalTextsAndUpdate,
  highlightStage,
  updateActiveElements, updateSignalTexts
} from './graphHelpers/helperSVGObject';
import {CPU_STATES} from './bindingSubjects';

@Injectable({
  providedIn: 'root'
})
export class GraphService {
  public initiated = false;

  // Target where the canvas will be put
  public currentArea: Areas;

  public update = {
    animations: true,
    highlightStageOnCPUChange: false,
    updateVisibilities: true,
    updateSignalTexts: true
  };

  // Canvas will fill this dom
  private renderDom;
  private camera: PerspectiveCamera;
  private renderer: WebGLRenderer;
  private scene: Scene;
  // Set by requestAnimationFrame to render next frame
  private frameId: number;
  private time = 0;
  private clock = new Clock();

  // Intersection related
  // centeredMouse is update once the mouse is moved, so set start to value which never could be to prevent
  private renderLoopFunctions: ((time: number, deltaTime: number) => void)[] = [];
  private renderGroup; // Holds the meshes in js groups named according to svg names
  private globalUniforms = {
    u_time: {value: 0},
    u_resolution: {value: new Vector2(0, 0)}
  };
  // intersection on 0,0 before mouse is moved
  private centeredMouse = new Vector2(-10000, -10000);
  private mouse = new Vector2(-10000, -10000);

  // These arrays are linked by their elements
  // They only hold the data in different ways
  // If a mesh is added it first needs to be added to the idRoot
  private intersectedElement;
  private mouseDownElement;
  private mouseFocusIsAnimating;
  private raycaster: Raycaster;
  private hoverTooltipInstance: Instance<Props>;
  // Than the idFlat needs to be regenerated to allow the element to be accessed by e.g. mux identifiers
  private idFlat: IdFlatInterface; // Takes the parsed svg with meshes and flattens all names to be a 1D array
  private idRoot: IdRootInterface; // Holds the parsed svg and adds meshes to each element
  private signals: Signal[];

  constructor(private ngZone: NgZone, private cpu: CPUService) {
  }

  /**
   * Setup scene inside domElement and start rendering
   * @param domElement Target of render. This function will add a canvas matching the size of the domElement.
   */
  public init(domElement: HTMLElement) {
    this.ngZone.runOutsideAngular(() => {
      this.renderDom = domElement;
      if (this.initiated) {
        // Service already loaded scene, only set dom element again and start rendering
        this.renderDom.appendChild(this.renderer.domElement);
        this.resize();
        this.render();
        panzoom(this.camera, this.renderDom);
      } else {
        // Setup renderer
        this.scene = new Scene();
        this.renderer = new WebGLRenderer({alpha: true, antialias: true});
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.domElement.style.outline = 'none';
        this.renderDom.appendChild(this.renderer.domElement);

        // Setup camera
        this.camera = this.setupCamera(this.renderDom.clientWidth, this.renderDom.clientHeight);

        // Setup scene with light
        this.scene.add(...this.setupLights());

        // Initiate objects from svg
        ({
          idRoot: this.idRoot,
          idFlat: this.idFlat,
          renderGroup: this.renderGroup
        } = initiateSVGObjects());

        // Add render group to scene
        this.scene.add(this.renderGroup);

        // Update signals texts if they change
        addSignalTextsAndUpdate(this.cpu.bindings, this.idFlat, this.idRoot, this.update);

        // Add signal change if cpuCycle is complete
        this.cpu.bindings.cycleComplete.subscribe(() => {
          if (this.update.updateVisibilities) {
            updateActiveElements(this.cpu.bindings, this.idFlat, this.update.animations);
            if (this.update.highlightStageOnCPUChange) {
              highlightStage(this.idFlat, this.cpu.bindings.cpuState.value, this.update.animations);
            }
          }
        });

        // For intersection
        this.raycaster = new Raycaster();
        this.renderDom.addEventListener('mousemove', this.setLocalMouseVariables.bind(this), false);
        this.renderDom.addEventListener('mouseleave', this.setLocalMouseVariables.bind(this,true), false);

        // Enable resizing
        window.addEventListener('resize', this.resize.bind(this));
        this.resize();

        // Enable zooming
        panzoom(this.camera, domElement);

        // Add tooltips
        this.hoverTooltipInstance = tippy(this.renderer.domElement, {
          content: 'Context menu',
          trigger: 'manual',
          theme: 'light',
          interactive: true,
          arrow: true,
          allowHTML: true,
          offset: [0, 10]
        });

        // Start rendering
        if (document.readyState !== 'loading') this.render();
        else window.addEventListener('DOMContentLoaded', this.render.bind(this));

        // Handle clicking to focus on element
        this.renderDom.addEventListener('mousedown', this.clickToZoom.bind(this, 'mousedown'))
        this.renderDom.addEventListener('mouseup', this.clickToZoom.bind(this, 'mouseup'))
        this.renderDom.addEventListener('mousemove', this.clickToZoom.bind(this, 'mousemove'))
        // this.renderDom.addEventListener('scroll', this.clickToZoom.bind(this, 'scroll')) // not working

        // Handle clicking to go into element / show info
        this.renderDom.addEventListener('dblclick', this.clickToShowInfo.bind(this, 'dblclick'))

        // Split areas in world and focusElement on the first
        // This needs to be away from initiateObjects
        // this.separateAreas();

        this.goToArea('overview');

        this.scene.add(this.setupBackground(this.idFlat));

        // Default no stage on
        highlightStage(this.idFlat, false, false);

        // Set initiated to true to not reload settings if init was called again by component using the service
        this.initiated = true;
      }
    });
  }

  /**
   * Updates all visibilities of elements
   */
  public updateGraph(animate) {
    updateActiveElements(this.cpu.bindings, this.idFlat, animate);
    highlightStage(this.idFlat, this.cpu.bindings.cpuState.value, animate);
    updateSignalTexts(this.signals);
  }

  /**
   * Go to a new focusArea.
   * @param newArea Will be appended with "area_" by function. Camera will focusElement all elements inside.
   * @param animateTransition If this transition should be animated
   */
  public async goToArea(newArea: Areas, animateTransition?) {
    // Block if change comes too early
    if (!this.idFlat || newArea === this.currentArea) return;

    animateTransition = animateTransition && this.update.animations;

    // If one goes back to the overview the reverse animation will be shown
    const reverse = newArea == 'overview';
    // If the transition is from sub to another sub disable animation
    if (!reverse && this.currentArea !== 'overview') animateTransition = false;
    // Get the animation element if animateTransitions is on
    const animationElement = animateTransition ? TABS[reverse ? this.currentArea : newArea] : null;

    // Hide elements of current focusArea only if there is one selected, else skip this and only show
    hideElement(this.idFlat, 'area_' + newArea, false);

    if (animationElement && !reverse) {
      await Promise.all([new Promise((resolve) => {
        const {center} = getCenterOfMeshes(this.idFlat[animationElement].meshes);
        animate({
          from: 0,
          to: 1,
          ease: linear,
          duration: 1000,
          onUpdate: (v) => this.camera.position.lerp(center, v),
          onComplete: () => resolve()
        });
      }), hideElement(this.idFlat, 'area_' + this.currentArea, true)]);

      // Focus on new focusArea
      focusCameraOnElement(this.camera, this.idFlat, 'areaborder_' + newArea, false);

      // This can be async as the camera can move now
      // Show meshes at new location
      showElement(this.idFlat, 'area_' + newArea, true).then(() => updateActiveElements(this.cpu.bindings, this.idFlat, this.update.animations));

    } else if (animationElement && reverse) {
      await hideElement(this.idFlat, 'area_' + this.currentArea, true);
      focusCameraOnElement(this.camera, this.idFlat, 'areaborder_' + newArea, false);

      // Show meshes at new location async
      showElement(this.idFlat, 'area_' + newArea, true).then(() => updateActiveElements(this.cpu.bindings, this.idFlat, this.update.animations));

      // Lerp camera from center of animationElement to full view
      const {center} = getCenterOfMeshes(this.idFlat[animationElement].meshes);
      this.camera.position.copy(center);
      await focusCameraOnElement(this.camera, this.idFlat, 'areaborder_' + newArea, true);
    } else {
      if (!this.update.animations)
        hideElement(this.idFlat, 'area_' + this.currentArea, false);
      else
        await hideElement(this.idFlat, 'area_' + this.currentArea, true);
      focusCameraOnElement(this.camera, this.idFlat, 'areaborder_' + newArea, false);
      showElement(this.idFlat, 'area_' + newArea, true).then(() => updateActiveElements(this.cpu.bindings, this.idFlat, this.update.animations));
    }

    this.currentArea = newArea;
  }

  /**
   * Go to focusElement element. Camera will fit the focusElement element.
   * @param id The id of the element. Will be appended with "focus_" by function.
   */
  public async goToFocus(id: string) {
    await focusCameraOnElement(this.camera, this.idFlat, 'focus_' + id, true);
  }

  /**
   * Highlight stage elements of selected cpuStage
   * @param idFlat
   * @param cpuStage
   * @param animateTransition
   */
  public highlightStage(cpuStage: CPU_STATES, animateTransition) {
    highlightStage(this.idFlat, cpuStage, animateTransition);
  }

  /**
   * Stop the rendering. Start again by calling init().
   */
  public stopRender() {
    if (this.frameId) {
      cancelAnimationFrame(this.frameId);
    }
  }

  /**
   * Will be called every render function with time and delta time
   * @param func Callback to call every new render
   */
  public runInRenderLoop(func: (time: number, deltaTime: number) => void): void {
    this.renderLoopFunctions.push(func);
  }

  /**
   * Adds the main camera
   * @private
   */
  private setupCamera(width, height): PerspectiveCamera {
    const camera = new PerspectiveCamera(45, width / height, 0.1, 1000000);
    camera.position.z = 50;
    return camera;
  }

  /**
   * Adds lights.
   * @private
   */
  private setupLights(): Light[] {
    const color = 0xffffff;
    const intensity = 1;
    const light = new DirectionalLight(color, intensity);
    light.position.set(0, 0, 10);
    light.target.position.set(0, 0, 0);
    const ambientLight = new AmbientLight(0xcccccc, 0.2);

    return [light, ambientLight];
  }

  /**
   * Adds the background mesh and centers it in the background of riscv_test. Must be called after first render.
   * @private
   */
  private setupBackground(idFlat: IdFlatInterface): Mesh {
    const loader = new TextureLoader();
    const backgroundTexture = loader.load(BACKGROUND_IMAGE);
    backgroundTexture.wrapS = backgroundTexture.wrapT = RepeatWrapping;
    backgroundTexture.repeat.set(50, 50);
    const backgroundGeometry = new PlaneGeometry(5000, 5000, 1, 1);
    const backgroundMaterial = new MeshBasicMaterial({
      map: backgroundTexture
    });

    const backgroundMesh = new Mesh(backgroundGeometry, backgroundMaterial);
    const backgroundPosition = getCenterOfMeshes(idFlat['risc_test'].meshes).center;
    backgroundPosition.z = -50;
    backgroundMesh.position.copy(backgroundPosition);
    return backgroundMesh;
  }

  /**
   * Handle intersections with mouse
   * @private
   */
  private handleIntersection() {
    // Intersection
    this.raycaster.setFromCamera(this.centeredMouse, this.camera);

    // Show Tooltip on intersection
    const removeTooltip = () => {
      if (this.intersectedElement) {
        // this.intersectedElement.material.color.setHex(this.intersectedElement.currentHex);
        this.hoverTooltipInstance.hide();
      }
      this.hoverTooltipInstance.hide();
      this.intersectedElement = null;
    };
    const intersects = this.raycaster.intersectObjects(this.scene.children, true);
    if (intersects.length > 0) {
      const getName = (i) => {
        if (i?.parent?.parent?.name?.startsWith('p_')) return {name: i.parent.parent.name, type: 'p'};
        if (i?.parent?.parent?.name?.startsWith('m_')) return {name: i.parent.parent.name, type: 'm'};
        if (i?.parent?.parent?.name?.startsWith('w_')) return {name: i.parent.parent.name, type: 'w'};
        if (i?.parent?.name?.startsWith('p_')) return {name: i.parent.name, type: 'p'};
        if (i?.parent?.name?.startsWith('m_')) return {name: i.parent.name, type: 'm'};
        if (i?.parent?.name?.startsWith('w_')) return {name: i.parent.name, type: 'w'};
        if (i?.name?.startsWith('s_')) return {name: i.name, type: 's'};
        if (i?.name?.startsWith('w_')) return {name: i.name, type: 'w'};
        if (i?.name?.startsWith('m_')) return {name: i.name, type: 'm'};
      };

      let object;
      for (const intersection of intersects) {
        object = getName(intersection.object);
        if (object) break;
      }

      if (object) {
        if (JSON.stringify(this.intersectedElement) != JSON.stringify(object)) {
          if (this.intersectedElement) {
            this.hoverTooltipInstance.hide();
          }
          this.intersectedElement = object;

          this.hoverTooltipInstance.setProps({
            getReferenceClientRect: () => ({
              width: 0,
              height: 0,
              top: this.mouse.y,
              bottom: this.mouse.y,
              left: this.mouse.x,
              right: this.mouse.x
            })
          });

          let name;
          let id;
          let prevalue;
          let value;
          let desc;
          switch (object.type) {
            case 'w':
            case 's':
              id = getSName(object.name) || getWName(object.name);
              prevalue = this.cpu.bindings.allValues[id]?.value === undefined ? id : this.cpu.bindings.allValues[id]?.value;
              name = RISCV_DEFINITIONS.signalsNPorts[id]?.name;
              value = (prevalue === null || prevalue === undefined) ? 'NaN' : prevalue.toString();
              desc = RISCV_DEFINITIONS.signalsNPorts[id]?.desc;
              this.hoverTooltipInstance.setContent('<strong>' + name + '</strong><br>Value: ' + value + (desc ? '<br>' + desc : ''));
              console.log(object.name, id, name, prevalue, value);
              break;
            case 'm':
              id = getModuleName(object.name);
              name = RISCV_DEFINITIONS.modules[id]?.name;
              desc = RISCV_DEFINITIONS.modules[id]?.desc;
              this.hoverTooltipInstance.setContent('<strong>' + name + '</strong>' + (desc ? '<br>' + desc : ''));
              console.log(object.name, id, name);
              break;
            case 'p':
              id = getPortName(object.name);
              prevalue = this.cpu.bindings.allValues[id]?.value === undefined ? id : this.cpu.bindings.allValues[id]?.value;
              name = RISCV_DEFINITIONS.signalsNPorts[id]?.name;
              value = (prevalue === null || prevalue === undefined) ? 'NaN' : prevalue.toString();
              desc = RISCV_DEFINITIONS.signalsNPorts[id]?.desc;
              this.hoverTooltipInstance.setContent('<strong>' + name + '</strong><br>Value: ' + value + (desc ? '<br>' + desc : ''));
              console.log(object.name, id, name, prevalue, value);
              break;
          }

          this.hoverTooltipInstance.show();
        } else {
          this.hoverTooltipInstance.setProps({
            getReferenceClientRect: () => ({
              width: 0,
              height: 0,
              top: this.mouse.y,
              bottom: this.mouse.y,
              left: this.mouse.x,
              right: this.mouse.x
            })
          });
        }
      } else {
        removeTooltip();
      }
    } else {
      removeTooltip();
    }
  }

  private clickToShowInfo(event) {
    forceStopFocus();

    if (this.intersectedElement) {
      if(this.intersectedElement.type === 'm') {
        const name = getModuleName(this.intersectedElement.name);
        if(name === 'alu' || name === 'cu' || name === 'be') {
          this.goToArea(name, true);
          // TODO: Change Tab in simulation
        } else if (name === 'registers') {
          // Open and mark registers
        } else if (name === 'memory') {
          // Open and mark memory
        }
      }
      console.log(this.intersectedElement);
    }
  }

  private clickToZoom(event: string) {
    if (this.mouseFocusIsAnimating && event === 'mousedown') {
      forceStopFocus();
    }

    if(event === 'mousemove' || event === 'scroll') {
      this.mouseDownElement = null;
    }

    if (this.intersectedElement) {
      if (event === 'mousedown') {
        this.mouseDownElement = this.intersectedElement;
      } else if (event === 'mouseup' && this.intersectedElement === this.mouseDownElement) {
        this.mouseDownElement = null;
        this.mouseFocusIsAnimating = true;
        centerCameraOnElement(this.camera, this.idFlat, this.intersectedElement.name, 200, true).then(() => {
          this.mouseFocusIsAnimating = false;
        })
      }
    }
  }

  private setLocalMouseVariables(event, mouseLeftCanvas = false) {
    if(mouseLeftCanvas) {
      this.mouse.x = 10000;
      this.mouse.y = 10000;
      this.centeredMouse.x = 10000;
      this.centeredMouse.y = 10000;
      return;
    }

    event.preventDefault();
    this.mouse.x = event.clientX;
    this.mouse.y = event.clientY;

    // TODO: Depends on where the dom is in relation to the other elements
    // Offset left because the dom does not start on the left border
    this.centeredMouse.x = ((event.clientX + this.renderDom.offsetLeft - (window.innerWidth - this.renderDom.clientWidth)) / this.renderDom.clientWidth) * 2 - 1;
    // Offset top because the dom does not start on the edge, additional - offset top because there is a header over all simulation elements
    this.centeredMouse.y = -((event.clientY - this.renderDom.offsetTop - (window.innerHeight - this.renderDom.clientHeight - this.renderDom.offsetTop)) / this.renderDom.clientHeight) * 2 + 1;
  }

  private render() {
    this.ngZone.runOutsideAngular(() => {
      this.frameId = requestAnimationFrame(this.render.bind(this));

      // update time
      const deltaTime = this.clock.getDelta();
      this.time += deltaTime;
      for (const func of this.renderLoopFunctions) {
        func(this.time, deltaTime);
      }

      // Set uniforms for shaders
      this.globalUniforms.u_time.value = this.time;

      // Handle interactability via intersections
      this.handleIntersection();

      this.renderer.render(this.scene, this.camera);
    });
  }

  private resize() {
    const width = this.renderDom.clientWidth;
    const height = this.renderDom.clientHeight;

    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    this.globalUniforms.u_resolution.value = new Vector2(width, height);
  }

}