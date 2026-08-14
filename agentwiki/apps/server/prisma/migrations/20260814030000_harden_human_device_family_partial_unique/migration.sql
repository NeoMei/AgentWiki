-- Enforce the contract invariant that a credential family can hold at most
-- one provisional and one active credential. The service layer serializes
-- exchange/activate under the family lock, but these partial unique indexes
-- make the invariant durable against bugs, races, or future callers.
CREATE UNIQUE INDEX "HumanDeviceCredential_one_provisional_per_family"
  ON "HumanDeviceCredential" ("credentialFamilyId")
  WHERE "status" = 'provisional';

CREATE UNIQUE INDEX "HumanDeviceCredential_one_active_per_family"
  ON "HumanDeviceCredential" ("credentialFamilyId")
  WHERE "status" = 'active';
