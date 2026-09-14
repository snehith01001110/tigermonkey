export class GameRuleError extends Error {
  constructor(message, code = "invalid_action") {
    super(message);
    this.name = "GameRuleError";
    this.code = code;
  }
}
