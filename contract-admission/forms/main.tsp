// Independent TypeSpec authority for the durable form envelope identity.
// The authored JSON Schema beside this file is an equal peer, not generated output.
// TypeSpec-generated JSON Schema is disposable comparison evidence only.
import "@typespec/json-schema";
using TypeSpec.JsonSchema;

namespace OptoSync.Forms;

@id("FormSchemaVersion")
enum FormSchemaVersion {
  v1: "opto-sync.form.v1",
}

@id("FormMode")
enum FormMode {
  native: "native",
  htmx: "htmx",
  manual: "manual",
}

@id("FormEnvelopeIdentity")
model FormEnvelopeIdentity {
  schemaVersion: FormSchemaVersion;
  submissionId: string;
  formName: string;
  mode: FormMode;
  queuedAt: string;
  createdAt: string;
  updatedAt: string;
  action?: string;
  method?: string;
  sourceUrl?: string;
}
