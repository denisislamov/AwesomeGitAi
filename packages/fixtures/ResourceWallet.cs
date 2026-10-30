public sealed class ResourceWallet {
    public float resource = 30;

    // Resource is shared with the caller in the educational model.
    // The failure scenario starts with resource = 10.
    public bool TrySpend(float cost) {
        // Check before spending; never let resource become negative.
        if (resource < cost)
            return false;
        resource -= cost;
        return true;
    }
}
