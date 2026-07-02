import { Injectable } from "@nestjs/common";

@Injectable()
export class AppService {
  getLandingPage(): string {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Wren</title>

    <style>
        *{
            margin:0;
            padding:0;
            box-sizing:border-box;
        }

        body{
            font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
            background:#09090B;
            color:#fff;
            display:flex;
            align-items:center;
            justify-content:center;
            min-height:100vh;
            overflow:hidden;
        }

        .container{
            text-align:center;
            max-width:700px;
            padding:32px;
        }

        .logo{
            font-size:70px;
            margin-bottom:20px;
        }

        h1{
            font-size:58px;
            font-weight:700;
            margin-bottom:12px;
        }

        p{
            color:#A1A1AA;
            font-size:18px;
            line-height:1.8;
            margin-bottom:40px;
        }

        .btn{
            display:inline-block;
            text-decoration:none;
            background:#4F7DFF;
            color:white;
            padding:14px 28px;
            border-radius:14px;
            font-weight:600;
            transition:.2s;
        }

        .btn:hover{
            background:#648CFF;
            transform:translateY(-2px);
        }

        footer{
            margin-top:60px;
            color:#666;
            font-size:14px;
        }
    </style>
</head>

<body>
    <div class="container">


        <div class="logo">🐦</div>

        <h1>Wren</h1>

        <p>
            An end-to-end encrypted social platform where your posts,
            conversations, and community belong only to you.
        </p>

        <footer>
            Wren Server • Running Successfully 🚀
        </footer>
    </div>
</body>
</html>
`;
  }
}
