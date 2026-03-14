/**
 * Snowflake ID Generator - Twitter's distributed ID generation algorithm
 * 
 * Structure: 64-bit long integer
 * - 1 bit: unused (sign bit)
 * - 41 bits: timestamp (milliseconds since epoch)
 * - 10 bits: machine ID (0-1023)
 * - 12 bits: sequence number (0-4095)
 */

export class SnowflakeIdGenerator {
  private static instance: SnowflakeIdGenerator;
  
  // Twitter Snowflake epoch (November 4, 2010 01:42:54.657 UTC)
  private readonly EPOCH = BigInt(1288834974657);
  
  // Bit allocations
  private readonly TIMESTAMP_BITS = BigInt(41);
  private readonly MACHINE_ID_BITS = BigInt(10);
  private readonly SEQUENCE_BITS = BigInt(12);
  
  // Max values
  private readonly MAX_MACHINE_ID = (BigInt(1) << this.MACHINE_ID_BITS) - BigInt(1); // 1023
  private readonly MAX_SEQUENCE = (BigInt(1) << this.SEQUENCE_BITS) - BigInt(1); // 4095
  
  // Bit shifts
  private readonly MACHINE_ID_SHIFT = this.SEQUENCE_BITS;
  private readonly TIMESTAMP_SHIFT = this.SEQUENCE_BITS + this.MACHINE_ID_BITS;
  
  private machineId: bigint;
  private sequence: bigint = BigInt(0);
  private lastTimestamp: bigint = BigInt(-1);
  
  constructor(machineId: number = 1) {
    if (machineId < 0 || machineId > Number(this.MAX_MACHINE_ID)) {
      throw new Error(`Machine ID must be between 0 and ${this.MAX_MACHINE_ID}`);
    }
    this.machineId = BigInt(machineId);
  }
  
  public static getInstance(machineId?: number): SnowflakeIdGenerator {
    if (!this.instance) {
      this.instance = new SnowflakeIdGenerator(machineId || 1);
    }
    return this.instance;
  }
  
  public generateId(): string {
    const timestamp = this.getCurrentTimestamp();
    
    if (timestamp < this.lastTimestamp) {
      throw new Error(`Clock moved backwards! Refusing to generate ID for ${this.lastTimestamp - timestamp}ms`);
    }
    
    if (timestamp === this.lastTimestamp) {
      this.sequence = (this.sequence + BigInt(1)) & this.MAX_SEQUENCE;
      if (this.sequence === BigInt(0)) {
        // Sequence overflow, wait for next millisecond
        return this.generateId();
      }
    } else {
      this.sequence = BigInt(0);
    }
    
    this.lastTimestamp = timestamp;
    
    // Build the ID
    const id = 
      ((timestamp - this.EPOCH) << this.TIMESTAMP_SHIFT) |
      (this.machineId << this.MACHINE_ID_SHIFT) |
      this.sequence;
    
    return id.toString();
  }
  
  private getCurrentTimestamp(): bigint {
    return BigInt(Date.now());
  }
  
  /**
   * Parse a Snowflake ID to extract timestamp, machine ID, and sequence
   */
  public parseId(id: string | bigint): {
    timestamp: Date;
    machineId: number;
    sequence: number;
  } {
    const snowflakeId = typeof id === 'string' ? BigInt(id) : id;
    
    const timestamp = ((snowflakeId >> this.TIMESTAMP_SHIFT) + this.EPOCH) * BigInt(1000000); // Convert to nanoseconds for Date constructor
    const machineId = Number((snowflakeId >> this.MACHINE_ID_SHIFT) & this.MAX_MACHINE_ID);
    const sequence = Number(snowflakeId & this.MAX_SEQUENCE);
    
    return {
      timestamp: new Date(Number(timestamp / BigInt(1000000))),
      machineId,
      sequence
    };
  }
  
  /**
   * Get the timestamp from a Snowflake ID
   */
  public getTimestamp(id: string | bigint): Date {
    return this.parseId(id).timestamp;
  }
  
  /**
   * Get the machine ID from a Snowflake ID
   */
  public getMachineId(id: string | bigint): number {
    return this.parseId(id).machineId;
  }
  
  /**
   * Get the sequence number from a Snowflake ID
   */
  public getSequence(id: string | bigint): number {
    return this.parseId(id).sequence;
  }
}

// Default instance for transaction ID generation
const snowflakeGenerator = SnowflakeIdGenerator.getInstance(1); // Machine ID 1 for transactions

/**
 * Generate a unique transaction ID using Snowflake algorithm
 */
export function generateTransactionId(): string {
  return snowflakeGenerator.generateId();
}

/**
 * Parse a transaction ID to extract its components
 */
export function parseTransactionId(id: string): {
  timestamp: Date;
  machineId: number;
  sequence: number;
} {
  return snowflakeGenerator.parseId(id);
}

/**
 * Get the creation timestamp from a transaction ID
 */
export function getTransactionTimestamp(id: string): Date {
  return snowflakeGenerator.getTimestamp(id);
}
