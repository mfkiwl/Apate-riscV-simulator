import { Injectable, OnDestroy } from '@angular/core';
import { Bindings, CPU_STATES } from './bindingSubjects';
import { readFileSync } from 'fs';
import {
  INSTRUCTIONS,
  isAUIPC,
  isBRANCH, isBREAK,
  isIMM,
  isJAL,
  isJALR,
  isLOAD,
  isLUI,
  isOP,
  isSTORE,
  parseInstruction
} from './instructionParser';
import { parseElf, parseElfRISCVInstructions } from './elfParser';


@Injectable({
  providedIn: 'root'
})
export class SimLibInterfaceService implements OnDestroy {
  public bindings = new Bindings();
  public elfIsLoaded = false;
  public parsedElf;

  constructor() {
  }

  initSimulation(pathToElf: string) {
    console.log(pathToElf);
    // Open ELF File
    const elfBuffer = readFileSync(pathToElf);
    this.parsedElf = parseElf(elfBuffer);
    parseElfRISCVInstructions(this.parsedElf, elfBuffer);

    console.log(this.parsedElf);
    // Read program
    this.parsedElf.program.copy(this.bindings.memory.value, 0, 0);
    // this.bindings.memory.next();
    this.bindings.pc.next(0);
    this.bindings.cpuState.next(CPU_STATES.READ_DATA_FROM_MEMORY);
    this.bindings.nextCpuState.next(CPU_STATES.READ_DATA_FROM_MEMORY);
    this.elfIsLoaded = true;
  }

  advanceSimulationClock() {
    switch (this.bindings.nextCpuState.value) {
      case CPU_STATES.BREAK:
        this.bindings.cpuState.next(CPU_STATES.BREAK);
        console.log("BREAK");
        return;
      case CPU_STATES.READ_DATA_FROM_MEMORY:
        this.bindings.memAddress.next(this.bindings.pc.value);
        this.bindings.memReadData.next(this.fetchDataFromMemory(this.bindings.memAddress.value));
        this.bindings.cpuState.next(CPU_STATES.READ_DATA_FROM_MEMORY);
        this.bindings.nextCpuState.next(CPU_STATES.DECODE_INSTRUCTION);
        break;
      case CPU_STATES.DECODE_INSTRUCTION:
        this.bindings.instruction.next(parseInstruction(this.bindings.memReadData.value));

        this.bindings.rs1addr.next(this.bindings.instruction.value.rs1);
        this.bindings.rs2addr.next(this.bindings.instruction.value.rs2);
        this.bindings.rs1.next(this.bindings.cpuregs.value[this.bindings.instruction.value.rs1]);
        this.bindings.rs2.next(this.bindings.cpuregs.value[this.bindings.instruction.value.rs2]);
        this.bindings.rd.next(this.bindings.instruction.value.rd);
        this.bindings.imm.next(this.bindings.instruction.value.imm);

        this.bindings.cpuState.next(CPU_STATES.DECODE_INSTRUCTION);

        if(isBREAK(this.bindings.instruction.value.name)) {
          this.bindings.nextCpuState.next(CPU_STATES.BREAK);
        } else {
          this.bindings.nextCpuState.next(CPU_STATES.EXECUTE);
        }
        break;
      case CPU_STATES.EXECUTE:
        //
        // LOAD STORE
        //

        if (isLOAD(this.bindings.instruction.value.name)) {
          this.bindings.memread.next(this.callMEMORYread(this.bindings.instruction.value, this.bindings.rs1_imm.value));
        } else if (isSTORE(this.bindings.instruction.value.name)) {
          this.callMEMORYwrite(this.bindings.instruction.value, this.bindings.rs1_imm.value, this.bindings.rs2.value);
        }

        this.bindings.cpuState.next(CPU_STATES.EXECUTE);
        this.bindings.nextCpuState.next(CPU_STATES.WRITE_BACK);
        break;
      case CPU_STATES.WRITE_BACK:
        if (isIMM(this.bindings.instruction.value.name) ||
          isOP(this.bindings.instruction.value.name) ||
          isJAL(this.bindings.instruction.value.name) ||
          isJALR(this.bindings.instruction.value.name) ||
          isLUI(this.bindings.instruction.value.name) ||
          isAUIPC(this.bindings.instruction.value.name) ||
          isLOAD(this.bindings.instruction.value.name)) {
          if(this.bindings.rd.value) {
            const cpuregs = this.bindings.cpuregs.value;
            cpuregs[this.bindings.rd.value] = this.bindings.regwrite.value;
            this.bindings.cpuregs.next(cpuregs);
          }
        }

        this.bindings.cpuState.next(CPU_STATES.WRITE_BACK);
        this.bindings.nextCpuState.next(CPU_STATES.ADVANCE_PC);
        break;
      case CPU_STATES.ADVANCE_PC:
        this.bindings.pc.next(this.bindings.pcAdv.value);

        this.bindings.cpuState.next(CPU_STATES.ADVANCE_PC);
        this.bindings.nextCpuState.next(CPU_STATES.READ_DATA_FROM_MEMORY);
        break;
    }

    // COMBINATORIAL LOGIC

    //
    // ALU
    //

    try {
      if (isIMM(this.bindings.instruction.value.name)) {
        this.bindings.imm_rs2.next(this.bindings.imm.value);
      } else if (isOP(this.bindings.instruction.value.name)) {
        this.bindings.imm_rs2.next(this.bindings.rs2.value);
      }

      if (isOP(this.bindings.instruction.value.name) || isIMM(this.bindings.instruction.value.name)) {
        this.bindings.op1.next(this.bindings.imm_rs2.value);
        this.bindings.op2.next(this.bindings.rs1.value);
      } else if (isJALR(this.bindings.instruction.value.name) || isJAL(this.bindings.instruction.value.name)) {
        this.bindings.op1.next(this.bindings.pc.value);
        this.bindings.op2.next(4);
      } else if (isLUI(this.bindings.instruction.value.name) || isAUIPC(this.bindings.instruction.value.name)) {
        this.bindings.op1.next(this.bindings.imm.value);
        this.bindings.op2.next(12);
      }

      this.bindings.aluout.next(this.callALU(this.bindings.op1.value, this.bindings.op2.value, this.bindings.instruction.value));
      this.bindings.pc_aluout.next(this.bindings.aluout.value + this.bindings.pc.value);
      this.bindings.mux_aluout.next(isAUIPC(this.bindings.instruction.value.name) ? this.bindings.pc_aluout.value : this.bindings.aluout.value);


      //
      // LOAD STORE
      //

      this.bindings.rs1_imm.next(this.bindings.rs1.value + this.bindings.imm.value);

      if (isLOAD(this.bindings.instruction.value.name)) {
        this.bindings.regwrite.next(this.bindings.memread.value);
      } else if (isIMM(this.bindings.instruction.value.name) ||
        isOP(this.bindings.instruction.value.name) ||
        isJAL(this.bindings.instruction.value.name) ||
        isJALR(this.bindings.instruction.value.name) ||
        isLUI(this.bindings.instruction.value.name) ||
        isAUIPC(this.bindings.instruction.value.name)) {
        this.bindings.regwrite.next(this.bindings.mux_aluout.value);
      }

      //
      // BRANCH
      //

      this.bindings.branchResultBEQ.next(this.bindings.rs1.value == this.bindings.rs2.value ? 1 : 0);
      this.bindings.branchResultBNE.next(this.bindings.rs1.value != this.bindings.rs2.value ? 1 : 0);
      this.bindings.branchResultBLT.next(this.bindings.rs1.value < this.bindings.rs2.value ? 1 : 0);
      this.bindings.branchResultBGE.next(this.bindings.rs1.value >= this.bindings.rs2.value ? 1 : 0);

      if (this.bindings.instruction.value.name === INSTRUCTIONS.BEQ) {
        this.bindings.branchResult.next(this.bindings.branchResultBEQ.value);
      } else if (this.bindings.instruction.value.name === INSTRUCTIONS.BNE) {
        this.bindings.branchResult.next(this.bindings.branchResultBNE.value);
      } else if (this.bindings.instruction.value.name === INSTRUCTIONS.BLT || this.bindings.instruction.value.name === INSTRUCTIONS.BLTU) {
        this.bindings.branchResult.next(this.bindings.branchResultBLT.value);
      } else if (this.bindings.instruction.value.name === INSTRUCTIONS.BGE || this.bindings.instruction.value.name === INSTRUCTIONS.BGEU) {
        this.bindings.branchResult.next(this.bindings.branchResultBGE.value);
      }

      //
      // PC
      //

      if (this.bindings.branchResult.value === 1) {
        this.bindings.branchAddResult.next(this.bindings.imm.value);
      } else {
        this.bindings.branchAddResult.next(4);
      }

      if (isJAL(this.bindings.instruction.value.name)) {
        this.bindings.pcAdd.next(this.bindings.imm.value);
      } else if (isBRANCH(this.bindings.instruction.value.name)) {
        this.bindings.pcAdd.next(this.bindings.branchAddResult.value);
      } else {
        this.bindings.pcAdd.next(4);
      }

      this.bindings.pcAdvOther.next(this.bindings.pc.value + this.bindings.pcAdd.value);
      this.bindings.pcAdvJALR.next(this.bindings.rs1.value + this.bindings.imm.value);

      if (isJALR(this.bindings.instruction.value.name)) {
        this.bindings.pcAdv.next(this.bindings.pcAdvJALR.value);
      } else {
        this.bindings.pcAdv.next(this.bindings.pcAdvOther.value);
      }
    } catch (e) {
      console.log("Some value was not initiated yet", e)
    }
  }

  callALU(op1, op2, instruction): number {
    switch (instruction.name) {
      case INSTRUCTIONS.JAL:
      case INSTRUCTIONS.JALR:
      case INSTRUCTIONS.ADDI:
      case INSTRUCTIONS.ADD:
        console.log('ALU ADD');
        return op1 + op2;
      case INSTRUCTIONS.SUB:
        console.log('ALU SUB');
        return op1 - op2;
      case INSTRUCTIONS.XOR:
      case INSTRUCTIONS.XORI:
        console.log('ALU XOR');
        return op1 ^ op2;
      case INSTRUCTIONS.OR:
      case INSTRUCTIONS.ORI:
        console.log('ALU OR');
        return op1 | op2;
      case INSTRUCTIONS.AND:
      case INSTRUCTIONS.ANDI:
        console.log('ALU AND');
        return op1 & op2;
      case INSTRUCTIONS.SLL:
      case INSTRUCTIONS.SLLI:
      case INSTRUCTIONS.LUI:
      case INSTRUCTIONS.AUIPC:
        console.log('ALU <<');
        return op1 << op2;
      case INSTRUCTIONS.SRL:
      case INSTRUCTIONS.SRA:
      case INSTRUCTIONS.SRLI:
      case INSTRUCTIONS.SRAI:
        console.log('ALU >>');
        return op1 >> op2;
      case INSTRUCTIONS.SLT:
      case INSTRUCTIONS.SLTI:
      case INSTRUCTIONS.SLTU:
      case INSTRUCTIONS.SLTIU:
        console.log('ALU SLT');
        return op1 < op2 ? 1 : 0;
      default:
        return 0;
    }
  }

  callMEMORYread(instruction, address): number {
    const memoryValue = this.fetchDataFromMemory(address);
    switch (instruction.name) {
      case INSTRUCTIONS.LB:
        // sign-extend
        console.log('MEMORY LB at ' + address);
        return (memoryValue & 0b11111111);
      case INSTRUCTIONS.LBU:
        // zero-extend
        console.log('MEMORY LBU at ' + address);
        return (memoryValue & 0b11111111);
      case INSTRUCTIONS.LH:
        // sign-extend
        console.log('MEMORY LH at ' + address);
        return (memoryValue & 0b1111111111111111);
      case INSTRUCTIONS.LHU:
        // zero-extend
        console.log('MEMORY LHU at ' + address);
        return (memoryValue & 0b1111111111111111);
      case INSTRUCTIONS.LW:
        console.log('MEMORY LW at ' + address);
        return memoryValue & 0b11111111111111111111111111111111;
      default:
        return 0;
    }
  }

  callMEMORYwrite(instruction, address, value) {
    const memory = this.bindings.memory.value;
    if (address == 23456) {
      this.bindings.callBufferWriteCallbacks(value);
      return;
    }
    switch (instruction.name) {
      case INSTRUCTIONS.SB:
        console.log('MEMORY SB ' + value + ' at ' + address);
        memory[address] = value & 0xFF;
        break;
      case INSTRUCTIONS.SH:
        console.log('MEMORY SH ' + value + ' at ' + address);
        memory[address] = value & 0xFF;
        memory[address + 1] = (value >> 0xFF) & 0xFF;
        break;
      case INSTRUCTIONS.SW:
        console.log('MEMORY SW ' + value + ' at ' + address);
        memory[address] = value & 0xFF;
        memory[address + 1] = (value >> 0xFF) & 0xFF;
        memory[address + 2] = (value >> 0xFFFF) & 0xFF;
        memory[address + 3] = (value >> 0xFFFFFF) & 0xFF;
        break;
    }
    this.bindings.memory.next(memory);
  }

  advanceSimulationPc() {
    let timeout = 10;
    this.advanceSimulationClock();
    while (timeout > 0 && this.bindings.nextCpuState.value != CPU_STATES.EXECUTE) {
      this.advanceSimulationClock();
      timeout--;
    }
  }

  runUntilBreak() {
    let timeout = 10000;

    const advance = () => {
      if (timeout > 0 && this.bindings.cpuState.value != CPU_STATES.BREAK) {
        setTimeout(() => {
          this.advanceSimulationClock();
          timeout--;
          advance();
        }, 5);
      }
    }

    advance();
  }

  read4BytesLittleEndian(data, location) {
    return data[location + 3] * 256 * 256 * 256
      + data[location + 2] * 256 * 256
      + data[location + 1] * 256
      + data[location + 0];
  }

  dec2bin(dec) {
    return (dec >>> 0).toString(2);
  }

  fetchDataFromMemory(location) {
    return this.read4BytesLittleEndian(this.bindings.memory.value, location);
  }

  ngOnDestroy(): void {

  }
}
