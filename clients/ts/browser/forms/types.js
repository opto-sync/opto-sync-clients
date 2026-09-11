export const FORM_SYNC_STATUS = Object.freeze({
    PENDING: 0,
    SYNCED: 1,
    FAILED: 2,
});
export const FORM_SCHEMA_VERSION = 'opto-sync.form.v1';
export const DEFAULT_FORM_TABLE = 'form_submissions';
export const DEFAULT_SUBMISSION_ID_FIELD = '_opto_submission_id';
export const DEFAULT_MUTATION_ID_FIELD = '_opto_mutation_id';
export const DEFAULT_FORM_DATABASE = 'OptoSyncFormDatabase';
export const DEFAULT_FORM_STORE = 'formMutations';
export const DEFAULT_MAX_PENDING_FORMS = 1_000;
export const DEFAULT_MAX_FORM_PAYLOAD_BYTES = 255 * 1024;
