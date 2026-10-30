using System.Numerics;
public sealed class Dash {
    readonly ResourceWallet resources = new();
    bool grounded = true, isDashing, active;
    Vector2 direction;
    int ticks;
    public bool TryDash(float cost, Vector2 input) {
        if (!grounded || isDashing || input == Vector2.Zero) return false;
        // Values in the scenario are captured before the highlighted line.
        bool spent = resources.TrySpend(cost);
        if (!spent) return false;
        direction = Vector2.Normalize(input);
        ticks = 10;
        active = true;
        return true;
    }
}
