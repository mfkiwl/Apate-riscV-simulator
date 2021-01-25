import {ChangeDetectorRef, Component, OnDestroy, OnInit, ViewChild} from '@angular/core';
import {byteToHex, range, readStyleProperty} from '../../utils/helper';
import {CPUService} from './services/cpu.service';
import {InstructionsComponent} from './components/instructions/instructions.component';
import {BehaviorSubject, Subject} from 'rxjs';
import {DataKeys, DataService} from '../../services/data.service';
import {GraphService} from './services/graph.service';
import RISCV_STAGES from '../../yamls/stages.yml';
import {Bindings, CPU_STATE_NAMES, CPU_STATES} from './services/bindingSubjects';
import {Areas} from './services/graphHelpers/helpers';
import {UntilDestroy} from "@ngneat/until-destroy";

@Component({
  selector: 'app-simulation',
  templateUrl: './simulation.component.html',
  styleUrls: ['./simulation.component.scss']
})
export class SimulationComponent {
  @ViewChild('instructionsComponent') instructionsComponent: InstructionsComponent;
  public byteToHex = byteToHex;
  public readStyleProperty = readStyleProperty;
  public range = range;
  // If step by step should be enabled
  public elaborateSteps = true;
  // Step may be disabled if animations are running
  public stepDisabled = false;
  public selectedTab: Areas = 'overview';
  // Displayed on top
  public stageName = 'Initiate the simulation';
  public stageSubject = new BehaviorSubject<CPU_STATES>(null);
  // Infotext
  public infoText;
  // Set by elaborate steps, will reset selectedTab to this
  private currentArea = this.selectedTab;
  private currentFocus;
  // Used by getNextInfo()
  private instrCounter = 0;
  private infoCounter = 0;

  constructor(
    public cpu: CPUService,
    private dataService: DataService,
    private graphService: GraphService,
    private changeDetection: ChangeDetectorRef
  ) {
    this.elaborateSteps = this.dataService.data[DataKeys.ELABORATE_STEPS].value;

    this.graphService.onChangeCurrentArea.subscribe(({area, animate}) => {
      this.goToArea(area, animate);
      // Comes from other zone, call change detection manually
      this.changeDetection.detectChanges();
    })
  }

  private _stage: CPU_STATES;

  public get stage() {
    return this._stage;
  }

  public set stage(stage: CPU_STATES) {
    this._stage = stage;
    this.stageSubject.next(this._stage);
  }

  onChangeElaborateSteps(newVal) {
    this.dataService.setSetting(DataKeys.ELABORATE_STEPS, newVal.checked);
    this.elaborateSteps = newVal.checked; // Set this only for the variable, does not affect the checkbox

    // Hide infos if not elaborate
    if (!this.elaborateSteps) {
      this.infoText = null;
    } else {
      this.setNextInfoByStage(this.stage);
    }
  }

  public goToArea(area, animate = false) {
    this.graphService.goToArea(area, animate);
    this.selectedTab = area;
  }

  initiateSimulation() {
    // Reset all cpu values
    this.cpu.bindings.clearAllValues();

    // For infoText getting
    this.instrCounter = 0;
    this.infoCounter = -1;

    // Set first stage text manually
    this.stageName = CPU_STATE_NAMES[CPU_STATES.FETCH];
    this.stage = CPU_STATES.FETCH;
    this.graphService.highlightStage(this.stage, false);

    // Load elf into CPU
    this.cpu.initSimulation(this.dataService.getSetting(DataKeys.ELF_PATH));
    // Wait for program counter to be 0 before reloading
    setTimeout(() => {
      this.instructionsComponent.reload();
    }, 100);
  }

  async stepSimulation() {
    if (!this.elaborateSteps) {
      this.stage = this.cpu.advanceSimulationClock();
      this.stageName = CPU_STATE_NAMES[this.stage];
      this.graphService.highlightStage(this.stage, true);
      console.log('%cCPU STATE: ' + this.stageName, 'color: #7827e0');
      return;
    }

    // Disable step before animation
    this.stepDisabled = true;

    const info = this.getNextInfo(this.cpu.bindings);
    this.infoText = info.text;

    if (info.exec) {
      console.log('%cCPU STATE: ' + this.cpu.advanceSimulationClock(), 'color: #7F2FeF');
    }

    if (info.startOfStage) {
      this.stage = info.startOfStage;
      this.stageName = CPU_STATE_NAMES[this.stage];
      this.graphService.highlightStage(this.stage, true);
    }

    if (info.highlight) {
      this.graphService.removeAllHighlights();
      for (const id of info.highlight) {
        this.graphService.highlightElement(id);
      }
    }

    // New area --> focus area
    // New focus --> apply new focus
    // Animations to focusArea
    if (info.focusArea) {
      // First show focusArea then focusElement element
      await this.graphService.goToArea(info.focusArea, true);
      this.selectedTab = info.focusArea;
      this.currentArea = info.focusArea;
      this.currentFocus = null; // Assume that we dont focus inside of area
      if (info.focusElement) {
        await this.graphService.goToFocus(info.focusElement);
        this.currentFocus = info.focusElement;
      }
    } else {
      // No new area but area is not the same --> focus area
      // Go to focusArea which should be displayed if the focusArea is not changing this time
      if (this.selectedTab !== this.currentArea) {
        await this.graphService.goToArea(this.currentArea, true);
        this.selectedTab = this.currentArea;
      }

      // No new area but new focus
      if (info.focusElement) {
        await this.graphService.goToFocus(info.focusElement);
        this.currentFocus = info.focusElement;
      }

      // No new focus but there is a current focus
      if (!info.focusElement && this.currentFocus) {
        // No new focus and no area --> apply old focus
        await this.graphService.goToFocus(this.currentFocus);
      }
    }


    // Enable step after animation
    this.stepDisabled = false;
  }

  /**
   * Find point in RISCV_STAGES to continue from. Uses the 'exec' property and finds the first matching stage
   * @param stage From which stage to continue
   */
  private setNextInfoByStage(stage: CPU_STATES) {
    let focusElement, focusArea;
    for (let i = 0; i < RISCV_STAGES.length; i++) {
      for (let j = 0; j < RISCV_STAGES[i].infos.length; j++) {
        const info = RISCV_STAGES[i].infos[j];
        focusArea = info.focusArea ? info.focusArea : focusArea;
        focusElement = info.focusElement ? info.focusElement : focusElement;
        console.log(stage, info.exec);
        if (stage === info.exec) {
          this.currentArea = focusArea;
          this.currentFocus = focusElement;
          this.infoCounter = j;
          this.instrCounter = i;
          return;
        }
      }
    }
  }

  /**
   * Get the next infoText text which fits current instruction and other {@link Bindings | Binding values} which can be checked by the 'if' property.
   *
   * Depends on {@link RISCV_STAGES | RISCV_STAGES}, this.infoCounter, this.instrCounter.
   *
   * Example {@link RISCV_STAGES | RISCV_STAGES} yaml:
   *
   * ```yaml
   * - instr: [branch]
   *   if: !!js/function  'function (bindings) { return bindings.branchResult.value == true; }'
   *   infos:
   * ```
   *
   * Checks:
   *
   * 1. 'bindings.instruction.value.opcodeName' needs to be inside the 'instr' array. <br>
   *
   * 2. If there is an 'if' parameter (optional, default true) this function will be executed.
   *
   * Both must equal true to display infos
   *
   * @param bindings Bin
   * @private
   */
  private getNextInfo(bindings: Bindings): { text: string; highlight: []; exec?: CPU_STATES; focusArea?: Areas; focusElement?: string; startOfStage?: CPU_STATES } {
    let startOfStage = null;

    if (this.infoCounter + 1 >= RISCV_STAGES[this.instrCounter].infos.length) {
      // There is no infoText left in this instruction, go to first infoText of new instruction
      this.infoCounter = 0;

      // eslint-disable-next-line no-constant-condition
      while (true) {
        // Which is the new instruction?
        // First check if a instruction exits in this stage
        if (this.instrCounter + 1 >= RISCV_STAGES.length) {
          // No new instruction exits
          // Reset counter
          this.instrCounter = -1; // -1 because loop checks one more time of instruction complies
        } else {
          this.instrCounter++;
          // Check if this instruction fullfills the requirements
          const instr = RISCV_STAGES[this.instrCounter];

          const compliesWithIf = (instr.if !== undefined) ? instr.if(bindings) : true;
          let compliesWithInstruction = true;
          if (instr.instr?.length > 0 && bindings.instruction.value) {
            compliesWithInstruction = instr.instr.indexOf(bindings.instruction.value.opcodeName) >= 0;
          }

          if (instr.start) {
            // Start of new stage
            // But must not be executed
            startOfStage = instr.start;
          }

          if ((compliesWithIf && compliesWithInstruction)) {
            // Does comply, break out of loop with new instruction counter set
            break;
          }
        }
      }
    } else {
      this.infoCounter++;
    }
    return { ...RISCV_STAGES[this.instrCounter].infos[this.infoCounter], startOfStage: startOfStage };
  }
}
