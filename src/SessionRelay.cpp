#include "SessionRelay.h"

#include <cstring>
#include <map>
#include <vector>

#if JUCE_WINDOWS
 #include <netfw.h>
#endif

namespace s3
{
namespace
{
constexpr int maxPeers = 12;
constexpr int maxMessage = 8 * 1024 * 1024;

uint32_t rotl (uint32_t v, int n) { return (v << n) | (v >> (32 - n)); }

struct Sha1
{
    uint32_t h[5] = { 0x67452301u, 0xEFCDAB89u, 0x98BADCFEu, 0x10325476u, 0xC3D2E1F0u };
    uint8_t block[64] {};
    uint64_t bits = 0;
    int n = 0;

    void add (const void* data, size_t len)
    {
        auto* p = static_cast<const uint8_t*> (data);
        bits += (uint64_t) len * 8;

        while (len > 0)
        {
            auto take = juce::jmin ((size_t) (64 - n), len);
            std::memcpy (block + n, p, take);
            n += (int) take;
            p += take;
            len -= take;

            if (n == 64)
            {
                transform();
                n = 0;
            }
        }
    }

    void transform()
    {
        uint32_t w[80];

        for (int i = 0; i < 16; ++i)
            w[i] = ((uint32_t) block[i * 4] << 24) | ((uint32_t) block[i * 4 + 1] << 16)
                 | ((uint32_t) block[i * 4 + 2] << 8) | (uint32_t) block[i * 4 + 3];

        for (int i = 16; i < 80; ++i)
            w[i] = rotl (w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);

        auto a = h[0], b = h[1], c = h[2], d = h[3], e = h[4];

        for (int i = 0; i < 80; ++i)
        {
            uint32_t f, k;

            if (i < 20)      { f = (b & c) | (~b & d); k = 0x5A827999u; }
            else if (i < 40) { f = b ^ c ^ d;          k = 0x6ED9EBA1u; }
            else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDCu; }
            else             { f = b ^ c ^ d;          k = 0xCA62C1D6u; }

            auto t = rotl (a, 5) + f + e + k + w[i];
            e = d; d = c; c = rotl (b, 30); b = a; a = t;
        }

        h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e;
    }

    void finish (uint8_t out[20])
    {
        auto messageBits = bits;
        block[n++] = 0x80;

        if (n > 56)
        {
            while (n < 64) block[n++] = 0;
            transform();
            n = 0;
        }

        while (n < 56) block[n++] = 0;

        for (int i = 0; i < 8; ++i)
            block[56 + i] = (uint8_t) (messageBits >> (56 - 8 * i));

        transform();

        for (int i = 0; i < 5; ++i)
        {
            out[i * 4]     = (uint8_t) (h[i] >> 24);
            out[i * 4 + 1] = (uint8_t) (h[i] >> 16);
            out[i * 4 + 2] = (uint8_t) (h[i] >> 8);
            out[i * 4 + 3] = (uint8_t) h[i];
        }
    }
};

juce::String sha1Base64 (const juce::String& text)
{
    Sha1 sha;
    sha.add (text.toRawUTF8(), text.getNumBytesAsUTF8());
    uint8_t dig[20];
    sha.finish (dig);
    return juce::Base64::toBase64 (dig, sizeof (dig));
}

bool handshakeOk()
{
    Sha1 empty;
    uint8_t dig[20];
    empty.finish (dig);
    static const uint8_t known[20] = { 0xda, 0x39, 0xa3, 0xee, 0x5e, 0x6b, 0x4b, 0x0d, 0x32, 0x55,
                                        0xbf, 0xef, 0x95, 0x60, 0x18, 0x90, 0xaf, 0xd8, 0x07, 0x09 };
    if (std::memcmp (dig, known, 20) != 0)
        return false;

    return sha1Base64 ("dGhlIHNhbXBsZSBub25jZQ==258EAFA5-E914-47DA-95CA-C5AB0DC85B11") == "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=";
}

bool writeAll (juce::StreamingSocket& socket, const void* data, int n)
{
    auto* p = static_cast<const char*> (data);
    int sent = 0;

    while (sent < n)
    {
        if (socket.waitUntilReady (false, 5000) != 1)
            return false;

        auto wrote = socket.write (p + sent, n - sent);
        if (wrote <= 0)
            return false;

        sent += wrote;
    }

    return true;
}

bool readExact (juce::StreamingSocket& socket, void* dest, int n, int timeoutMs)
{
    auto* p = static_cast<char*> (dest);
    int got = 0;
    auto deadline = juce::Time::getMillisecondCounter() + (juce::uint32) timeoutMs;

    while (got < n)
    {
        auto now = juce::Time::getMillisecondCounter();
        if (now >= deadline)
            return false;

        if (socket.waitUntilReady (true, (int) (deadline - now)) != 1)
            return false;

        auto r = socket.read (p + got, n - got, false);
        if (r <= 0)
            return false;

        got += r;
    }

    return true;
}

juce::String cleanText (const juce::String& in, int maxChars)
{
    juce::String out;

    for (auto c : in)
        if (c >= 32)
            out += c;

    return out.trim().substring (0, maxChars);
}

bool validCode (const juce::String& code)
{
    if (code.length() < 4 || code.length() > 16)
        return false;

    for (auto c : code)
        if (! ((c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')))
            return false;

    return true;
}

bool sameSecret (const juce::String& a, const juce::String& b)
{
    auto na = a.getNumBytesAsUTF8();
    auto nb = b.getNumBytesAsUTF8();
    auto n = juce::jmax (na, nb);
    unsigned diff = (unsigned) (na ^ nb);
    auto* pa = a.toRawUTF8();
    auto* pb = b.toRawUTF8();

    for (size_t i = 0; i < n; ++i)
    {
        auto ca = i < na ? (unsigned char) pa[i] : 0u;
        auto cb = i < nb ? (unsigned char) pb[i] : 0u;
        diff |= (unsigned) (ca ^ cb);
    }

    return diff == 0;
}

bool privateAddress (const juce::String& s)
{
    if (s.startsWith ("10.") || s.startsWith ("192.168."))
        return true;

    if (! s.startsWith ("172."))
        return false;

    auto n = s.fromFirstOccurrenceOf ("172.", false, false).upToFirstOccurrenceOf (".", false, false).getIntValue();
    return n >= 16 && n <= 31;
}

juce::String pickLan()
{
    juce::Array<juce::IPAddress> addresses;
    juce::IPAddress::findAllAddresses (addresses, false);
    juce::String other;

    for (auto& address : addresses)
    {
        auto s = address.toString();
        if (s.isEmpty() || s == "127.0.0.1" || s == "0.0.0.0" || s.startsWith ("169.254."))
            continue;

        if (s.startsWith ("192.168."))
            return s;

        if (other.isEmpty() && privateAddress (s))
            other = s;
    }

    return other.isNotEmpty() ? other : juce::String ("127.0.0.1");
}

bool globalV4 (const juce::String& ip)
{
    if (ip.isEmpty() || ip.contains (":"))
        return false;

    auto a = ip.upToFirstOccurrenceOf (".", false, false).getIntValue();
    auto b = ip.fromFirstOccurrenceOf (".", false, false).upToFirstOccurrenceOf (".", false, false).getIntValue();

    if (a <= 0 || a >= 224 || a == 10 || a == 127)
        return false;
    if (a == 192 && b == 168)
        return false;
    if (a == 169 && b == 254)
        return false;
    if (a == 172 && b >= 16 && b <= 31)
        return false;
    if (a == 100 && b >= 64 && b <= 127)
        return false;

    return true;
}

juce::String httpText (const juce::String& url)
{
    auto stream = juce::URL (url).createInputStream (juce::URL::InputStreamOptions (juce::URL::ParameterHandling::inAddress)
                                                         .withConnectionTimeoutMs (2500)
                                                         .withNumRedirectsToFollow (2));
    return stream != nullptr ? stream->readEntireStreamAsString() : juce::String();
}

juce::String soapCall (const juce::String& url, const juce::String& service, const juce::String& action, const juce::String& inner)
{
    auto body = "<?xml version=\"1.0\"?>"
                "<s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\">"
                "<s:Body><u:" + action + " xmlns:u=\"" + service + "\">" + inner + "</u:" + action + "></s:Body></s:Envelope>";
    int status = 0;
    auto stream = juce::URL (url).withPOSTData (body).createInputStream (
        juce::URL::InputStreamOptions (juce::URL::ParameterHandling::inPostData)
            .withExtraHeaders ("Content-Type: text/xml; charset=\"utf-8\"\r\nSOAPAction: \"" + service + "#" + action + "\"\r\n")
            .withConnectionTimeoutMs (2500)
            .withStatusCode (&status));

    if (stream == nullptr)
        return {};

    auto text = stream->readEntireStreamAsString();
    if (status >= 400 || text.containsIgnoreCase ("Fault"))
        return {};

    return text.isEmpty() ? juce::String ("ok") : text;
}

juce::String ssdpLocation()
{
    juce::DatagramSocket sock (true);
    if (! sock.bindToPort (0))
        return {};

    const char* searches[] = {
        "M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\nMX: 1\r\nST: urn:schemas-upnp-org:service:WANIPConnection:1\r\n\r\n",
        "M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\nMX: 1\r\nST: urn:schemas-upnp-org:service:WANPPPConnection:1\r\n\r\n"
    };

    for (auto* search : searches)
    {
        sock.waitUntilReady (false, 300);
        sock.write ("239.255.255.250", 1900, search, (int) std::strlen (search));
    }

    auto deadline = juce::Time::getMillisecondCounter() + 1800;

    while (juce::Time::getMillisecondCounter() < deadline)
    {
        auto left = (int) (deadline - juce::Time::getMillisecondCounter());
        if (left <= 0 || sock.waitUntilReady (true, left) != 1)
            break;

        char buf[2048] {};
        juce::String sender;
        int senderPort = 0;
        auto n = sock.read (buf, (int) sizeof (buf) - 1, false, sender, senderPort);
        if (n <= 0)
            continue;

        auto text = juce::String::fromUTF8 (buf, n);
        if (! text.containsIgnoreCase ("LOCATION:"))
            continue;

        auto location = text.fromFirstOccurrenceOf ("LOCATION:", false, true).upToFirstOccurrenceOf ("\r", false, false).trim();
        if (location.isNotEmpty())
            return location;
    }

    return {};
}

struct Gateway { juce::String control, service; };

Gateway findGateway()
{
    auto location = ssdpLocation();
    if (location.isEmpty())
        return {};

    auto xml = httpText (location);
    auto urnAt = xml.indexOfIgnoreCase ("urn:schemas-upnp-org:service:WANIPConnection");
    if (urnAt < 0)
        urnAt = xml.indexOfIgnoreCase ("urn:schemas-upnp-org:service:WANPPPConnection");
    if (urnAt < 0)
        return {};

    auto service = xml.substring (urnAt).upToFirstOccurrenceOf ("<", false, false).trim();
    auto serviceStart = xml.substring (0, urnAt).lastIndexOfIgnoreCase ("<service");
    if (serviceStart < 0)
        serviceStart = 0;
    auto serviceEnd = xml.indexOfIgnoreCase (urnAt, "</service>");
    if (serviceEnd < 0)
        serviceEnd = juce::jmin (xml.length(), urnAt + 2500);

    auto block = xml.substring (serviceStart, serviceEnd);
    auto tag = block.indexOfIgnoreCase ("controlURL");
    if (tag < 0)
        return {};

    auto value = block.substring (tag).fromFirstOccurrenceOf (">", false, false).upToFirstOccurrenceOf ("<", false, false).trim();
    if (value.isEmpty())
        return {};

    if (value.startsWithIgnoreCase ("http"))
        return { value, service };

    auto rest = location.fromFirstOccurrenceOf ("://", false, false);
    auto origin = location.upToFirstOccurrenceOf ("://", true, false) + rest.upToFirstOccurrenceOf ("/", false, false);
    return { value.startsWith ("/") ? origin + value : origin + "/" + value, service };
}

#if JUCE_WINDOWS
void allowInbound (int port)
{
    auto hr = CoInitializeEx (nullptr, COINIT_APARTMENTTHREADED);
    auto uninit = SUCCEEDED (hr);
    INetFwPolicy2* policy = nullptr;

    if (FAILED (CoCreateInstance (__uuidof (NetFwPolicy2), nullptr, CLSCTX_INPROC_SERVER, __uuidof (INetFwPolicy2), (void**) &policy)) || policy == nullptr)
    {
        if (uninit)
            CoUninitialize();
        return;
    }

    INetFwRules* rules = nullptr;
    policy->get_Rules (&rules);
    auto name = SysAllocString (L"Studio 4000 session");
    if (rules != nullptr)
        rules->Remove (name);

    INetFwRule* rule = nullptr;
    if (rules != nullptr && SUCCEEDED (CoCreateInstance (__uuidof (NetFwRule), nullptr, CLSCTX_INPROC_SERVER, __uuidof (INetFwRule), (void**) &rule)) && rule != nullptr)
    {
        auto exe = SysAllocString (juce::File::getSpecialLocation (juce::File::currentExecutableFile).getFullPathName().toWideCharPointer());
        auto ports = SysAllocString (juce::String (port).toWideCharPointer());
        rule->put_Name (name);
        rule->put_ApplicationName (exe);
        rule->put_Protocol (NET_FW_IP_PROTOCOL_TCP);
        rule->put_LocalPorts (ports);
        rule->put_Direction (NET_FW_RULE_DIR_IN);
        rule->put_Action (NET_FW_ACTION_ALLOW);
        rule->put_Enabled (VARIANT_TRUE);
        rule->put_Profiles (NET_FW_PROFILE2_ALL);
        rules->Add (rule);
        SysFreeString (exe);
        SysFreeString (ports);
        rule->Release();
    }

    SysFreeString (name);
    if (rules != nullptr)
        rules->Release();
    policy->Release();
    if (uninit)
        CoUninitialize();
}
#else
void allowInbound (int) {}
#endif
}

struct SessionRelay::Impl
{
    struct Conn : std::enable_shared_from_this<Conn>
    {
        std::unique_ptr<juce::StreamingSocket> socket;
        juce::CriticalSection write;
        std::atomic<bool> open { true };
        juce::String id;
        juce::String room;
        bool joined = false;

        bool sendFrame (uint8_t opcode, const void* data, size_t len)
        {
            if (! open.load())
                return false;

            juce::MemoryOutputStream frame;
            frame.writeByte ((char) (0x80 | opcode));

            if (len < 126)
                frame.writeByte ((char) len);
            else if (len <= 65535)
            {
                frame.writeByte ((char) 126);
                frame.writeByte ((char) ((len >> 8) & 0xff));
                frame.writeByte ((char) (len & 0xff));
            }
            else
            {
                frame.writeByte ((char) 127);
                for (int i = 7; i >= 0; --i)
                    frame.writeByte ((char) ((len >> (i * 8)) & 0xff));
            }

            if (len > 0)
                frame.write (data, len);

            const juce::ScopedLock sl (write);
            if (! open.load())
                return false;

            auto ok = writeAll (*socket, frame.getData(), (int) frame.getDataSize());
            if (! ok)
                open.store (false);

            return ok;
        }

        bool sendText (const juce::String& text)
        {
            return sendFrame (1, text.toRawUTF8(), text.getNumBytesAsUTF8());
        }

        void shutdown()
        {
            open.store (false);
            if (socket != nullptr)
                socket->close();
        }
    };

    struct Peer
    {
        juce::String id, name;
        bool host = false;
        int index = 0;
        std::shared_ptr<Conn> conn;
    };

    struct Room
    {
        juce::String password;
        std::map<juce::String, Peer> peers;
        int nextIndex = 0;
    };

    juce::CriticalSection lock;
    std::map<juce::String, Room> rooms;

    var peerList (const Room& room) const
    {
        juce::Array<var> list;

        for (auto& entry : room.peers)
        {
            auto& peer = entry.second;
            list.add (Obj().set ("id", peer.id).set ("name", peer.name)
                           .set ("role", peer.host ? "host" : "guest").set ("index", peer.index));
        }

        return var (list);
    }

    void forget (const std::shared_ptr<Conn>& conn)
    {
        if (! conn->joined)
            return;

        std::vector<std::shared_ptr<Conn>> drop;
        juce::String peersMsg;
        {
            const juce::ScopedLock sl (lock);
            auto found = rooms.find (conn->room);
            if (found == rooms.end())
                return;

            auto& room = found->second;
            auto peer = room.peers.find (conn->id);
            if (peer == room.peers.end())
                return;

            auto wasHost = peer->second.host;
            room.peers.erase (peer);
            conn->joined = false;

            if (wasHost || room.peers.empty())
            {
                for (auto& entry : room.peers)
                    drop.push_back (entry.second.conn);

                rooms.erase (found);
            }
            else
            {
                peersMsg = juce::JSON::toString (Obj().set ("type", "peers").set ("peers", peerList (room)), true);

                for (auto& entry : room.peers)
                    drop.push_back (entry.second.conn);
            }
        }

        if (peersMsg.isEmpty())
        {
            for (auto& other : drop)
                other->shutdown();
        }
        else
        {
            for (auto& other : drop)
                other->sendText (peersMsg);
        }
    }

    void join (const std::shared_ptr<Conn>& conn, const var& msg)
    {
        auto code = cleanText (msg["room"].toString(), 16).toUpperCase();
        const bool hosting = msg["role"].toString() == "host";
        auto name = cleanText (msg["name"].toString(), 40);
        if (name.isEmpty())
            name = "Musician";
        auto password = msg["password"].toString();

        if (! validCode (code))
        {
            conn->sendText (juce::JSON::toString (Obj().set ("type", "error").set ("message", "That session code isn't valid"), true));
            return;
        }

        juce::String welcome;
        juce::String fail;
        {
            const juce::ScopedLock sl (lock);
            auto& room = rooms[code];

            if (hosting)
            {
                for (auto& entry : room.peers)
                    if (entry.second.host)
                    {
                        fail = "That session already has a host";
                        break;
                    }

                if (fail.isEmpty())
                    room.password = password;
            }
            else
            {
                auto hasHost = false;
                for (auto& entry : room.peers)
                    hasHost = hasHost || entry.second.host;

                if (! hasHost)
                    fail = "No live session with that code. Check it with the host.";
                else if (room.password.isNotEmpty() && ! sameSecret (room.password, password))
                    fail = "Wrong session password";
                else if ((int) room.peers.size() >= maxPeers)
                    fail = "The session is full";
            }

            if (fail.isEmpty())
            {
                Peer peer;
                peer.id = juce::Uuid().toString().removeCharacters ("{}");
                peer.name = name;
                peer.host = hosting;
                peer.index = room.nextIndex++;
                peer.conn = conn;
                conn->id = peer.id;
                conn->room = code;
                conn->joined = true;
                welcome = juce::JSON::toString (Obj().set ("type", "welcome").set ("id", peer.id).set ("index", peer.index), true);
                room.peers[peer.id] = peer;
            }
            else if (room.peers.empty())
                rooms.erase (code);
        }

        if (fail.isNotEmpty())
        {
            conn->sendText (juce::JSON::toString (Obj().set ("type", "error").set ("message", fail), true));
            return;
        }

        conn->sendText (welcome);
        juce::String peersMsg;
        std::vector<std::shared_ptr<Conn>> targets;
        {
            const juce::ScopedLock sl (lock);
            auto found = rooms.find (code);

            if (found != rooms.end())
            {
                peersMsg = juce::JSON::toString (Obj().set ("type", "peers").set ("peers", peerList (found->second)), true);

                for (auto& entry : found->second.peers)
                    targets.push_back (entry.second.conn);
            }
        }

        for (auto& target : targets)
            target->sendText (peersMsg);
    }

    void relay (const std::shared_ptr<Conn>& conn, const var& msg)
    {
        std::vector<std::shared_ptr<Conn>> targets;
        juce::String out;
        {
            const juce::ScopedLock sl (lock);
            auto found = rooms.find (conn->room);
            if (found == rooms.end() || found->second.peers.find (conn->id) == found->second.peers.end())
                return;

            out = juce::JSON::toString (Obj().set ("type", "from").set ("from", conn->id).set ("data", msg["data"]), true);
            auto target = msg["target"].toString();

            if (target.isEmpty() || target == "*")
            {
                for (auto& entry : found->second.peers)
                    if (entry.first != conn->id)
                        targets.push_back (entry.second.conn);
            }
            else if (auto to = found->second.peers.find (target); to != found->second.peers.end())
                targets.push_back (to->second.conn);

            juce::ignoreUnused (found);
        }

        for (auto& to : targets)
            to->sendText (out);
    }

    void onMessage (const std::shared_ptr<Conn>& conn, const juce::String& text)
    {
        auto msg = juce::JSON::parse (text);
        if (! msg.isObject())
            return;

        if (! conn->joined)
        {
            if (msg["type"].toString() == "join")
                join (conn, msg);
            return;
        }

        if (msg["type"].toString() == "to")
            relay (conn, msg);
    }

    void closeAll()
    {
        std::vector<std::shared_ptr<Conn>> all;
        {
            const juce::ScopedLock sl (lock);
            for (auto& roomEntry : rooms)
                for (auto& peerEntry : roomEntry.second.peers)
                    all.push_back (peerEntry.second.conn);

            rooms.clear();
        }

        for (auto& conn : all)
            conn->shutdown();
    }
};

SessionRelay::SessionRelay (Rpc& r) : juce::Thread ("Studio 4000 sessions"), rpc (r), impl (std::make_unique<Impl>())
{
    registerMethods();
}

SessionRelay::~SessionRelay()
{
    stop();
}

void SessionRelay::publish()
{
    auto gateway = findGateway();
    juce::String shown;

    if (gateway.control.isNotEmpty() && port > 0)
    {
        auto ports = juce::String (port);
        auto addBody = "<NewRemoteHost></NewRemoteHost><NewExternalPort>" + ports
                     + "</NewExternalPort><NewProtocol>TCP</NewProtocol><NewInternalPort>" + ports
                     + "</NewInternalPort><NewInternalClient>" + lan
                     + "</NewInternalClient><NewEnabled>1</NewEnabled><NewPortMappingDescription>Studio 4000</NewPortMappingDescription><NewLeaseDuration>0</NewLeaseDuration>";
        auto added = soapCall (gateway.control, gateway.service, "AddPortMapping", addBody);

        if (added.isEmpty())
        {
            soapCall (gateway.control, gateway.service, "DeletePortMapping",
                      "<NewRemoteHost></NewRemoteHost><NewExternalPort>" + ports + "</NewExternalPort><NewProtocol>TCP</NewProtocol>");
            added = soapCall (gateway.control, gateway.service, "AddPortMapping", addBody);
        }

        if (added.isNotEmpty())
        {
            auto ipXml = soapCall (gateway.control, gateway.service, "GetExternalIPAddress", {});
            auto ip = ipXml.fromFirstOccurrenceOf ("NewExternalIPAddress>", false, true).upToFirstOccurrenceOf ("<", false, false).trim();

            if (ip.isEmpty())
            {
                auto looked = httpText ("https://api.ipify.org").trim();
                if (globalV4 (looked))
                    ip = looked;
            }

            if (globalV4 (ip))
            {
                shown = ip + ":" + ports;
                const juce::ScopedLock sl (shareLock);
                mapControl = gateway.control;
                mapService = gateway.service;
                mapExternal = port;
            }
        }
    }

    if (shown.isEmpty() && globalV4 (lan))
        shown = lan + ":" + juce::String (port);
    if (shown.isEmpty())
        shown = lan + ":" + juce::String (port);

    {
        const juce::ScopedLock sl (shareLock);
        advertise = shown;
    }

    allowInbound (port);
    reachReady.store (true);
    reachEvent.signal();
    juce::Logger::writeToLog ("Studio 4000 sessions reachable at " + shown);
}

void SessionRelay::unmap()
{
    juce::String control, service;
    int external = 0;
    {
        const juce::ScopedLock sl (shareLock);
        control = mapControl;
        service = mapService;
        external = mapExternal;
        mapExternal = 0;
        mapControl = {};
    }

    if (control.isNotEmpty() && external > 0)
        soapCall (control, service, "DeletePortMapping",
                  "<NewRemoteHost></NewRemoteHost><NewExternalPort>" + juce::String (external) + "</NewExternalPort><NewProtocol>TCP</NewProtocol>");
}

bool SessionRelay::start()
{
    if (isThreadRunning())
        return true;

    if (! handshakeOk())
    {
        juce::Logger::writeToLog ("Studio 4000 session connection failed its own handshake check");
        return false;
    }

    lan = pickLan();

    for (int p = 3031; p <= 3040; ++p)
    {
        listener.close();

        if (listener.createListener (p))
        {
            port = p;
            reachEvent.reset();
            reachReady.store (false);
            publishing.store (1);
            juce::Thread::launch ([this]
            {
                publish();
                publishing.store (0);
            });
            startThread();
            return true;
        }
    }

    port = 0;
    return false;
}

void SessionRelay::stop()
{
    signalThreadShouldExit();
    listener.close();
    reachEvent.signal();
    for (int i = 0; i < 200 && publishing.load() > 0; ++i)
        juce::Thread::sleep (20);
    unmap();
    if (impl != nullptr)
        impl->closeAll();
    stopThread (3000);

    for (int i = 0; i < 150 && clients.load() > 0; ++i)
        juce::Thread::sleep (20);
}

void SessionRelay::registerMethods()
{
    rpc.add ("collab.relay", Rpc::Kind::read, "The session connection this app is hosting", "{}", [this] (const var&)
    {
        if (! isThreadRunning())
            start();

        if (! reachReady.load())
            reachEvent.wait (4000);

        juce::String shown;
        {
            const juce::ScopedLock sl (shareLock);
            shown = advertise;
        }
        if (shown.isEmpty())
            shown = lan + ":" + juce::String (port);

        return var (Obj().set ("running", isThreadRunning())
                         .set ("port", port)
                         .set ("local", "ws://127.0.0.1:" + juce::String (port))
                         .set ("share", shown));
    });
}

void SessionRelay::run()
{
    while (! threadShouldExit())
    {
        std::unique_ptr<juce::StreamingSocket> client (listener.waitForNextConnection());

        if (client == nullptr)
        {
            if (threadShouldExit())
                break;

            wait (50);
            continue;
        }

        auto* raw = client.release();
        clients.fetch_add (1);

        if (! juce::Thread::launch ([this, raw]
        {
            auto socket = std::unique_ptr<juce::StreamingSocket> (raw);
            auto conn = std::make_shared<Impl::Conn>();
            conn->socket = std::move (socket);

            juce::String header;
            char ch = 0;
            auto upgraded = false;

            while (header.length() < 8192 && readExact (*conn->socket, &ch, 1, 5000))
            {
                header += ch;
                if (header.endsWith ("\r\n\r\n"))
                    break;
            }

            auto request = header.upToFirstOccurrenceOf ("\r\n", false, false);
            auto websocket = header.containsIgnoreCase ("Upgrade: websocket");
            juce::String key;

            for (auto line : juce::StringArray::fromLines (header))
            {
                line = line.trim();
                auto name = line.upToFirstOccurrenceOf (":", false, false).trim();
                auto value = line.fromFirstOccurrenceOf (":", false, false).trim();
                if (name.equalsIgnoreCase ("Sec-WebSocket-Key"))
                    key = value;
            }

            if (websocket && key.isNotEmpty())
            {
                auto accept = sha1Base64 (key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11");
                auto response = "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: "
                              + accept + "\r\n\r\n";
                upgraded = writeAll (*conn->socket, response.toRawUTF8(), response.getNumBytesAsUTF8());
            }
            else
            {
                auto body = request.contains ("/health")
                    ? juce::String ("{\"ok\":true}")
                    : juce::String ("Studio 4000 session connection.\n");
                auto type = request.contains ("/health") ? "application/json" : "text/plain";
                auto response = "HTTP/1.1 200 OK\r\nContent-Type: " + juce::String (type) + "\r\nConnection: close\r\nContent-Length: "
                              + juce::String (body.getNumBytesAsUTF8()) + "\r\n\r\n" + body;
                writeAll (*conn->socket, response.toRawUTF8(), response.getNumBytesAsUTF8());
            }

            juce::MemoryBlock message;
            auto opcode = 0;

            while (upgraded && conn->open.load() && ! threadShouldExit())
            {
                if (conn->socket->waitUntilReady (true, 20000) != 1)
                {
                    if (! conn->sendFrame (0x9, nullptr, 0))
                        break;
                    continue;
                }

                uint8_t hdr[2];
                if (! readExact (*conn->socket, hdr, 2, 5000))
                    break;

                auto op = hdr[0] & 0x0f;
                auto fin = (hdr[0] & 0x80) != 0;
                auto masked = (hdr[1] & 0x80) != 0;
                uint64_t len = hdr[1] & 0x7f;

                if (len == 126)
                {
                    uint8_t ext[2];
                    if (! readExact (*conn->socket, ext, 2, 5000))
                        break;
                    len = ((uint64_t) ext[0] << 8) | ext[1];
                }
                else if (len == 127)
                {
                    uint8_t ext[8];
                    if (! readExact (*conn->socket, ext, 8, 5000))
                        break;
                    len = 0;
                    for (auto b : ext)
                        len = (len << 8) | b;
                }

                if (! masked || len > (uint64_t) maxMessage)
                    break;

                uint8_t mask[4];
                if (! readExact (*conn->socket, mask, 4, 5000))
                    break;

                juce::MemoryBlock payload;
                payload.setSize ((size_t) len, true);
                if (len > 0 && ! readExact (*conn->socket, payload.getData(), (int) len, 20000))
                    break;

                auto* bytes = static_cast<uint8_t*> (payload.getData());
                for (uint64_t i = 0; i < len; ++i)
                    bytes[i] ^= mask[i % 4];

                if (op == 0x8)
                    break;

                if (op == 0x9)
                {
                    conn->sendFrame (0xA, payload.getData(), (size_t) len);
                    continue;
                }

                if (op == 0xA)
                    continue;

                if (op == 0x1 || op == 0x2)
                {
                    message.reset();
                    opcode = op;
                }
                else if (op != 0)
                    break;

                message.append (payload.getData(), (size_t) len);

                if (fin && (opcode == 0x1 || opcode == 0x2))
                {
                    impl->onMessage (conn, juce::String::fromUTF8 ((const char*) message.getData(), (int) message.getSize()));
                    message.reset();
                    opcode = 0;
                }
            }

            conn->shutdown();
            impl->forget (conn);
            clients.fetch_sub (1);
        }))
        {
            delete raw;
            clients.fetch_sub (1);
        }
    }
}

}
