# Snowflake ID Implementation

## Overview
This project now implements Twitter's Snowflake algorithm for generating unique, sortable transaction IDs.

## Algorithm Structure
- **Total bits**: 64 bits
- **Sign bit**: 1 bit (unused, always 0)
- **Timestamp**: 41 bits (milliseconds since custom epoch)
- **Machine ID**: 10 bits (0-1023, identifies the generating machine)
- **Sequence**: 12 bits (0-4095, increments per millisecond)

## Features
- **Uniqueness**: Guaranteed unique across distributed systems
- **Sortable**: IDs are roughly sorted by generation time
- **High performance**: Can generate ~4 million IDs per second per machine
- **No coordination**: Each machine can generate IDs independently

## Configuration
- **Machine ID**: Set to 1 for transaction generation (configurable in `utils/snowflake.ts`)
- **Epoch**: November 4, 2010 01:42:54.657 UTC (Twitter's Snowflake epoch)

## Usage

### Backend
```typescript
import { generateTransactionId, parseTransactionId } from '../utils/snowflake';

// Generate new ID
const id = generateTransactionId(); // e.g., "1234567890123456789"

// Parse existing ID
const parsed = parseTransactionId(id);
console.log(parsed.timestamp); // Date object
console.log(parsed.machineId); // 1
console.log(parsed.sequence); // 1234
```

### Database Schema
- Transaction IDs stored as `STRING(20)` to accommodate 64-bit integers
- Migration provided: `20240314-update-transaction-id-for-snowflake.js`

## Migration Steps

1. **Update Database Schema**:
   ```bash
   npm run migrate
   ```

2. **Deploy Code**:
   - New Snowflake implementation
   - Updated Transaction model
   - No frontend changes required

3. **Verify**:
   - New transactions will have Snowflake IDs
   - Existing transactions remain unaffected
   - IDs will be roughly chronological

## Benefits Over Previous Implementation

1. **Sortable**: IDs naturally sort by creation time
2. **Distributed**: Multiple machines can generate IDs without conflicts
3. **Information**: IDs embed timestamp and machine information
4. **Performance**: No database round-trip needed for ID generation
5. **Standard**: Industry-proven algorithm used by Twitter, Discord, etc.

## Backward Compatibility

- Existing transactions with old IDs continue to work
- Frontend treats all IDs as strings, no changes needed
- Migration only affects new transactions

## Example IDs

Old format: `aBcDeFgHiJkLmNoPqRsTuVwXyZ`
New format: `1234567890123456789` (19-20 digit string)

Both formats are handled transparently by the application.
