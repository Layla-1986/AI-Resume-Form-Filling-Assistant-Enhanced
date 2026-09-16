(function initLocalAwardImport(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.LocalAwardImport = Object.freeze(api);
  }
})(typeof window !== "undefined" ? window : globalThis, function createLocalAwardImport() {
  "use strict";

  function awardKey(award) {
    return `${String(award?.awardDate || "").trim()}|${String(
      award?.name || ""
    )
      .trim()
      .toLocaleLowerCase()}`;
  }

  async function applyOneTimeAwardImport({
    resumeStorage,
    schema,
    storage,
    flagKey,
    awards,
  }) {
    if (!storage?.local?.get || !storage?.local?.set) {
      throw new Error("扩展本地存储不可用");
    }

    const flagState = await storage.local.get(flagKey);
    if (flagState?.[flagKey]) {
      return { applied: false, added: 0 };
    }

    const current = await resumeStorage.loadResumeData(storage);
    const normalizedCurrent = schema.normalizeResumeProfile(current.profile);
    const existingAwards = Array.isArray(normalizedCurrent.awards)
      ? normalizedCurrent.awards
      : [];
    const existingKeys = new Set(existingAwards.map(awardKey));
    const missingAwards = (Array.isArray(awards) ? awards : []).filter((award) => {
      const key = awardKey(award);
      if (!award?.name || existingKeys.has(key)) return false;
      existingKeys.add(key);
      return true;
    });
    const nextProfile = schema.normalizeResumeProfile({
      ...normalizedCurrent,
      awards: [...missingAwards, ...existingAwards],
    });

    await resumeStorage.saveResumeData(
      {
        profile: nextProfile,
        schemaVersion: schema.version,
        rawText: current.rawText,
      },
      storage
    );
    await storage.local.set({ [flagKey]: true });
    return { applied: true, added: missingAwards.length };
  }

  function fillAwardDescriptions(profile) {
    let updated = 0;
    const awards = (profile.awards || []).map((award) => {
      const name = String(award?.name || "").trim();
      if (!name || String(award.description || "").trim()) return award;
      const recognition = [award.level, award.rank]
        .map((value) => String(value || "").trim())
        .filter(Boolean)
        .join("");
      const description = `获得“${name}”${recognition}，相关成果经评审获得认可。`;
      updated += 1;
      return { ...award, description };
    });
    return { profile: { ...profile, awards }, updated };
  }

  return { applyOneTimeAwardImport, fillAwardDescriptions };
});
