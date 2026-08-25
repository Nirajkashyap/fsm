-- AUTO-GENERATED — do not edit by hand.
-- Source: packages/database-src/fsm.machine.schema.v3.json
-- Regenerate with: deno task generate:pg-types (run from packages/database-src)
--
-- Deliberately excluded (see generate-fsm-json-postgres-types.ts for why):
--   $defs.baseStateNode.properties.type — already fsm_core.fsm_state_type
--     (supabase/schemas/11_ext_base/20241219134646_fsm_table.sql)
--   $defs.actionObject's if/then conditional enum — not a real field
--     constraint, actionObject.type is free text

-- from $.$defs.invokeObject.properties.asyncOperationType
CREATE TYPE fsm_core.async_operation_type AS ENUM ('internalAsyncOperation', 'sharedAsyncOperation', 'fsm');

-- from $.$defs.invokeObject.properties.asyncOperationLanguage
CREATE TYPE fsm_core.async_operation_language AS ENUM ('typescript', 'python', 'rust', 'go', 'llm');

-- from $.$defs.historyStateNode.allOf.1.properties.history
CREATE TYPE fsm_core.fsm_history_type AS ENUM ('shallow', 'deep');

-- from $.properties.type
CREATE TYPE fsm_core.fsm_root_type AS ENUM ('compound', 'parallel');
