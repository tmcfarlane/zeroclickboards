let revision = 0;

// Shared by authentication intents, accepted sessions and delayed API replies.
export const getAuthSessionRevision = () => revision;
export const advanceAuthSessionRevision = () => ++revision;
