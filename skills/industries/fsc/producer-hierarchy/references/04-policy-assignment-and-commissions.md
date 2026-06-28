# Producer Hierarchy — Policy Assignment and Commissions

## ProducerPolicyAssignment

### Purpose

Links a `Producer` to an `InsurancePolicy`, establishing which agents and distribution entities sold or participated in the policy. One record per producer per policy — regardless of how many DST channels the producer appears in.

### Key fields

| Field | Type | Notes |
|---|---|---|
| `Id` | ID | System |
| `InsurancePolicyId` | Lookup(InsurancePolicy) | Required |
| `ProducerId` | Lookup(Producer) | Required — the assigned producer |
| `LineOfBusiness` | Picklist | `Commercial Property`, `Business Liability`, `Commercial Auto` |
| `Name` | Text | Auto-assigned — cannot be added as a related list column via Metadata API at API 65.0 |

### One-PPA-per-producer rule

Do not create multiple PPAs for the same producer on the same policy even if that producer appears in multiple DST channels. Channel tracking is handled by `InsProducerRelationship__c` and `AccountContactRelation`, not PPA count.

**Correct:** 1 PPA for Jennifer Duffy on Policy 22823736, even though she appears in both Thompson 004 and Legacy Wealth 106 channels.

**Wrong:** 2 PPAs for Jennifer Duffy on Policy 22823736 (one per DST channel). This doubles her production volume in reports and creates duplicate commission splits.

### PPA records per policy — reference demo

#### Policy 22823736 (dual DST via Raymond James RTF) — 6 PPAs

| Assigned Producer | Tier | Channel presence |
|---|---|---|
| Thompson 004 (510004) | DST | Channel 1 only |
| Legacy Wealth 106 (510106) | DST | Channel 2 only |
| Raymond James (452129) | RTF | Both channels (1 PPA) |
| Robert Krebs (623525) | Agent | Channel 1 only |
| Jennifer Duffy (623544) | Agent | Both channels (1 PPA) |
| Sandra Peters (623532) | Agent | Both channels (1 PPA) |

#### Policies 32706155, 22847017, 38603784 (Ray Jacobs floating agent) — 5 PPAs each

| Assigned Producer | Tier | Channel presence |
|---|---|---|
| Synergy Wealth 101 | DST | Channel 1 |
| Stellarix 026 | DST | Channel 2 |
| Colorado Wealth (678810) | CRP | Both channels (1 PPA) |
| Financial Planning (694504) | CRP | Channel 1 only |
| Ray Jacobs (616583) | Agent | All channels (1 PPA) |

---

## InsurancePolicyParticipant

### Purpose

Links the policyholder and other participant roles (Insured, Beneficiary, Owner) to the policy. Completely separate from `ProducerPolicyAssignment` — do not confuse them.

### Key fields

| Field | Type | Notes |
|---|---|---|
| `Id` | ID | System |
| `InsurancePolicyId` | Lookup(InsurancePolicy) | Required |
| `PrimaryParticipantAccountId` | Lookup(Account) | Participant Account — Person Account for policyholders |
| `PrimaryParticipantContactId` | Lookup(Contact) | Participant Contact |
| `Role` | Picklist | `Insured`, `Beneficiary`, `Owner`, `Driver`, `Member`, etc. |
| `IsActiveParticipant` | Checkbox | Whether the participant is currently active |

### Pattern: one InsurancePolicyParticipant per policy for the policyholder

```apex
InsurancePolicyParticipant ipp = new InsurancePolicyParticipant(
    InsurancePolicyId = policy.Id,
    PrimaryParticipantAccountId = policyholderPersonAccountId,
    Role = 'Insured',
    IsActiveParticipant = true
);
insert ipp;
```

---

## InsurancePolicy key fields for distribution context

| Field | Type | Notes |
|---|---|---|
| `Name` | Text | Required |
| `PolicyName` | Text | Human-readable policy name |
| `UniversalPolicyNumber` | Text | Carrier policy number |
| `Status` | Picklist | `In Force`, `Draft`, `Canceled`, `Lapsed`, `Terminated` |
| `EffectiveDate` | Date | Policy start date |
| `NameInsuredId` | Lookup(Account) | Required — the named insured Person Account |
| `ProducerId` | Lookup(Producer) | Writing/lead producer |
| `WritingCarrierAccountId` | Lookup(Account) | Carrier Business Account |

`ProducerId` on `InsurancePolicy` holds the writing agent's Producer. This is in addition to the `ProducerPolicyAssignment` records — the PPA list is the complete multi-producer ledger; `ProducerId` is the primary writing producer shortcut field.

---

## ProducerCommission

### Purpose

Tracks commission flow from the carrier master down to individual agent splits. This is a self-referential hierarchy using `ParentProducerCommissionId`.

### Key fields

| Field | Type | Notes |
|---|---|---|
| `Id` | ID | System |
| `Name` | Text | Commission record name |
| `ProducerId` | Lookup(Producer) | The producer receiving commission |
| `InsurancePolicyId` | Lookup(InsurancePolicy) | The policy this commission relates to |
| `CommissionAmount` | Currency | Payout amount for this producer |
| `CommissionableAmount` | Currency | Base amount commission is calculated against |
| `ParentProducerCommissionId` | Lookup(ProducerCommission) | Parent in commission hierarchy (null = master) |
| `ProcessingProducerId` | Lookup(Producer) | The producer processing/clearing the commission |
| `Status` | Picklist | Commission status |
| `Type` | Picklist | Commission type |

### Commission hierarchy pattern

```
ProducerCommission: MASTER
  ProducerId         = Carrier producer
  InsurancePolicyId  = Policy
  CommissionAmount   = $25,000 (full premium)
  ParentProducerCommissionId = null
        │
        ▼
ProducerCommission: CLEARING
  ProducerId         = Raymond James (RTF/aggregator)
  ProcessingProducerId = Raymond James
  CommissionAmount   = $25,000 (pass-through)
  ParentProducerCommissionId = MASTER.Id
        │
        ├─────────────────────────────────────────────
        ▼                    ▼                       ▼
SPLIT: Robert Krebs     SPLIT: Jennifer Duffy    SPLIT: Sandra Peters
  CommissionAmount=$X    CommissionAmount=$Y       CommissionAmount=$Z
  ParentId = CLEARING    ParentId = CLEARING       ParentId = CLEARING
```

### Commission split example (Policy 22823736 — $25,000 premium, $1,200,000 face value)

| Producer | Role | Split % | CommissionAmount | FaceValue credit |
|---|---|---|---|---|
| Sarah Jenkins Individual | Writing Agent (Lead) | 60% | $15,000 | $720,000 |
| Michael Chang Individual | Co-Producer (Technical) | 30% | $7,500 | $360,000 |
| David Ross Individual | Servicing Associate | 10% | $2,500 | $120,000 |
| Beacon Wealth Corporate | Clearing Broker-Dealer | null | — | Institutional tracking |
| MassMutual Cap Dist | Wholesale Distributor | null | — | Carrier tracking |

Audit check: total split = 100%, total face value credit = $1,200,000 — no double-counting.

### Querying commission splits for a policy

```soql
SELECT Id, Name, ProducerId, ProducerId.Name, CommissionAmount, CommissionableAmount,
       ParentProducerCommissionId, Status
FROM ProducerCommission
WHERE InsurancePolicyId = :policyId
ORDER BY ParentProducerCommissionId NULLS FIRST
```

The record where `ParentProducerCommissionId = null` is the master. Its children are clearing records. Their children are the individual splits.

---

## Production volume reporting

Because each producer has exactly one PPA per policy, production volume reports group by `ProducerPolicyAssignment.ProducerId` and join to `InsurancePolicy.NameInsuredAmount` or face value. There is no risk of double-counting as long as the one-PPA-per-producer rule is maintained.

To calculate production volume per agent:
```soql
SELECT ProducerId, ProducerId.Name, SUM(InsurancePolicies.NameInsuredAmount)
FROM ProducerPolicyAssignment
WHERE InsurancePolicy.Status = 'In Force'
GROUP BY ProducerId, ProducerId.Name
```

Note: This query form requires a custom rollup or report. Use standard Salesforce reports grouped by Producer with `InsurancePolicy.NameInsuredAmount` for production dashboards.
