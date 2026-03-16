// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract ProofTradeRegistry {
    struct AgentIdentity {
        string agentId;
        string agentUri;
        bytes32 promptHash;
        bytes32 policyHash;
        bool active;
        uint64 updatedAt;
    }

    struct ValidationRecord {
        string validationId;
        string validationType;
        bytes32 validationHash;
        string evidenceUri;
        uint64 issuedAt;
    }

    struct LicenseRecord {
        uint8 currentLevel;
        bool active;
        bool revoked;
        bytes32 certificateHash;
        string evidenceUri;
        uint64 issuedAt;
    }

    struct AuditRecord {
        string auditReportId;
        string auditorAgentId;
        string verdict;
        bytes32 auditHash;
        string evidenceUri;
        uint64 issuedAt;
    }

    mapping(bytes32 => AgentIdentity) public agentIdentities;
    mapping(bytes32 => ValidationRecord) public validationRecords;
    mapping(bytes32 => LicenseRecord) public licenseRecords;
    mapping(bytes32 => AuditRecord) public auditRecords;

    event AgentRegistered(
        bytes32 indexed agentKey,
        string agentId,
        string agentUri,
        bytes32 promptHash,
        bytes32 policyHash,
        bool active,
        uint64 updatedAt
    );

    event ValidationPublished(
        bytes32 indexed agentKey,
        string validationId,
        string validationType,
        bytes32 validationHash,
        string evidenceUri,
        uint64 issuedAt
    );

    event LicensePublished(
        bytes32 indexed agentKey,
        uint8 currentLevel,
        bool active,
        bool revoked,
        bytes32 certificateHash,
        string evidenceUri,
        uint64 issuedAt
    );

    event AuditPublished(
        bytes32 indexed agentKey,
        string auditReportId,
        string auditorAgentId,
        string verdict,
        bytes32 auditHash,
        string evidenceUri,
        uint64 issuedAt
    );

    function registerOrUpdateAgent(
        bytes32 agentKey,
        string calldata agentId,
        string calldata agentUri,
        bytes32 promptHash,
        bytes32 policyHash,
        bool active,
        uint64 updatedAt
    ) external {
        agentIdentities[agentKey] = AgentIdentity({
            agentId: agentId,
            agentUri: agentUri,
            promptHash: promptHash,
            policyHash: policyHash,
            active: active,
            updatedAt: updatedAt
        });

        emit AgentRegistered(
            agentKey,
            agentId,
            agentUri,
            promptHash,
            policyHash,
            active,
            updatedAt
        );
    }

    function publishValidation(
        bytes32 agentKey,
        string calldata validationId,
        string calldata validationType,
        bytes32 validationHash,
        string calldata evidenceUri,
        uint64 issuedAt
    ) external {
        validationRecords[agentKey] = ValidationRecord({
            validationId: validationId,
            validationType: validationType,
            validationHash: validationHash,
            evidenceUri: evidenceUri,
            issuedAt: issuedAt
        });

        emit ValidationPublished(
            agentKey,
            validationId,
            validationType,
            validationHash,
            evidenceUri,
            issuedAt
        );
    }

    function publishLicense(
        bytes32 agentKey,
        uint8 currentLevel,
        bool active,
        bool revoked,
        bytes32 certificateHash,
        string calldata evidenceUri,
        uint64 issuedAt
    ) external {
        licenseRecords[agentKey] = LicenseRecord({
            currentLevel: currentLevel,
            active: active,
            revoked: revoked,
            certificateHash: certificateHash,
            evidenceUri: evidenceUri,
            issuedAt: issuedAt
        });

        emit LicensePublished(
            agentKey,
            currentLevel,
            active,
            revoked,
            certificateHash,
            evidenceUri,
            issuedAt
        );
    }

    function publishAudit(
        bytes32 agentKey,
        string calldata auditReportId,
        string calldata auditorAgentId,
        string calldata verdict,
        bytes32 auditHash,
        string calldata evidenceUri,
        uint64 issuedAt
    ) external {
        auditRecords[agentKey] = AuditRecord({
            auditReportId: auditReportId,
            auditorAgentId: auditorAgentId,
            verdict: verdict,
            auditHash: auditHash,
            evidenceUri: evidenceUri,
            issuedAt: issuedAt
        });

        emit AuditPublished(
            agentKey,
            auditReportId,
            auditorAgentId,
            verdict,
            auditHash,
            evidenceUri,
            issuedAt
        );
    }
}
