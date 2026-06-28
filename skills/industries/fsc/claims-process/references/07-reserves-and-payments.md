# Reserves and Payments

## Object Hierarchy

```
ClaimCoverage
  └── ClaimReserve       (financial ceiling per coverage line)
        └── ClaimPayment (actual disbursements against the reserve)
```

One `ClaimCoverage` → one `ClaimReserve`. One `ClaimReserve` → one or many `ClaimPayment` records (partial payments are allowed).

## `ClaimReserve`

The reserve is the adjuster's estimate of total financial exposure for a coverage line. It is set early and adjusted as the claim develops.

| Field | API Name | Notes |
|---|---|---|
| Claim Coverage | `ClaimCoverageId` | Parent coverage line |
| Claim | `ClaimId` | Parent claim |
| Reserve Type | `ReserveType` | `Indemnity`, `Expense`, `Medical`, `LegalExpense` |
| Reserve Amount | `ReserveAmount` | Ceiling — cannot be exceeded by sum of ClaimPayments |
| Initial Reserve | `InitialReserveAmount` | Set at creation; used for variance reporting |
| Reserve Status | `Status` | `Active`, `Closed`, `Pending` |
| Reserve Date | `ReserveDate` | Date reserve was established |

**Reserve sufficiency rule**: `SUM(ClaimPayment.Amount WHERE ClaimReserveId = :id) <= ClaimReserve.ReserveAmount`

Implement as an Apex before-insert/before-update trigger on `ClaimPayment`:
```apex
Decimal sumPaid = [SELECT SUM(Amount) total FROM ClaimPayment
                   WHERE ClaimReserveId = :newPayment.ClaimReserveId
                   AND PaymentStatus != 'Voided'].total;
if (sumPaid + newPayment.Amount > reserve.ReserveAmount) {
    newPayment.addError('Payment amount exceeds available reserve. Adjust reserve first.');
}
```

## Reserve Adjustment

When damage estimate changes during adjudication, update `ClaimReserve.ReserveAmount`:
1. Create `ClaimAction` with `ActionType = 'ReserveAdjustment'` (add to ActionType picklist) capturing old and new amount.
2. Update `ClaimReserve.ReserveAmount`.
3. Manager approval required if adjustment increases reserve by more than threshold in `ClaimsReserveThreshold__mdt`.

## `ClaimPayment`

| Field | API Name | Notes |
|---|---|---|
| Claim | `ClaimId` | Parent claim |
| Claim Coverage | `ClaimCoverageId` | Coverage line being paid |
| Claim Reserve | `ClaimReserveId` | Reserve being drawn against |
| Amount | `Amount` | Payment amount (after deductible) |
| Payee | `PayeeId` | Contact or Account receiving payment |
| Payment Method | `PaymentMethod` | `Check`, `EFT`, `Wire`, `VirtualCard` |
| Payment Status | `PaymentStatus` | `Pending`, `Approved`, `Issued`, `Failed`, `Voided` |
| Payment Date | `PaymentDate` | Date payment was issued |
| Payment Reference | `PaymentReference` | Check number, transaction ID, etc. |
| Deductible Applied | `DeductibleApplied` | Boolean; was deductible subtracted? |

## Payment Lifecycle

```
Pending → Approved → Issued
             │           └── (success)
             └── Failed → resubmit or void
Issued → Voided  (only with supervisor approval)
```

Status transition rules:
- `Pending → Approved`: adjuster or payment workflow approves
- `Approved → Issued`: external payment system confirms; Integration Procedure updates status
- `Approved → Failed`: payment system returns error; create `ClaimAction(PaymentFailed)`
- `Issued → Voided`: supervisor-only; requires `ClaimAction(VoidPayment)` with reason

## Payment Integration Procedure Pattern

```
Trigger: ClaimPayment.PaymentStatus transitions to 'Approved'
Steps:
  1. Fetch ClaimPayment details + Payee bank/mailing info
  2. DataRaptor Transform: build payment API request payload
  3. HTTP Action: POST to payment processor Named Credential
  4. Response handler:
     IF success → Update ClaimPayment.PaymentStatus = 'Issued', PaymentDate = today, PaymentReference = txnId
     IF failure → Update ClaimPayment.PaymentStatus = 'Failed', create ClaimAction(PaymentFailed)
```

## Deductible Calculation

Net payment = gross damage amount − deductible − salvage (if applicable):

```
ClaimPayment.Amount = ClaimItem.DamageAmount
                    - InsurancePolicyCoverage.Deductible
                    - SalvageValue (auto total loss only)
```

Record deductible collection separately if the claimant must pay it directly (not always relevant — depends on first-party vs. third-party claim).

## Partial Payments

Multiple `ClaimPayment` records are allowed per `ClaimCoverage`:
- Interim payment (e.g., advance while investigation continues)
- Partial settlement on one item while another is still under review
- Supplemental payment after initial payment (new damage discovered)

Track via `ClaimPayment.PaymentType` (add picklist value: `Initial`, `Supplemental`, `Final`, `Advance`).

## Reserve Reconciliation at Closure

Before setting `Claim.Status = 'Closed'`:
1. Verify all `ClaimPayment` records are `Issued` or `Voided`.
2. Sum all `Issued` payments per `ClaimReserve`.
3. Update `ClaimReserve.ReserveAmount` = actual sum paid (release unused reserve).
4. Set `ClaimReserve.Status = 'Closed'`.
5. Create `ClaimAction(Close)`.

Automate via Record-Triggered Flow on `Claim` when `Status` → `'Closed'`.

## Subrogation

When the insurer recovers costs from a liable third party:
- Create a separate `ClaimPayment` with `PaymentType = 'SubrogationRecovery'` and negative amount (or a custom `ClaimRecovery__c` object if required by local regulatory standards).
- Link to the original `ClaimCoverage`.
- Track `ClaimAction(SubrogationFiled)` and `ClaimAction(SubrogationRecovered)`.
